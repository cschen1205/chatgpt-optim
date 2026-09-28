import { ChatGPTDomAdapter } from "./dom-adapter";
import { emptyDiagnostics } from "./diagnostics";
import { Scheduler } from "./scheduler";
import { CONFIG, type Settings } from "./settings";
import { TurnRegistry, type TurnRecord } from "./turn-registry";
import { hasConflict, measure, setMode } from "./style-controller";
import { viewportDistance, scrollViewport, nextMode } from "./virtualizer";
export class OptimizerController {
  private adapter = new ChatGPTDomAdapter();
  private scheduler = new Scheduler();
  private registry = new TurnRegistry();
  private mutations?: MutationObserver;
  private textMutations?: MutationObserver;
  private resize?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private timer = 0;
  private hotTimer = 0;
  private resumeTimer = 0;
  private suspendedUntil = 0;
  private printing = false;
  private added = new Set<HTMLElement>();
  private needsDiscovery = false;
  private root: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private rootWidth = 0;
  private scrollerWidth = 0;
  private url = "";
  private running = false;
  private listeners?: AbortController;
  private diagnostics = emptyDiagnostics();
  private retryDelay = 500;
  private nextRetry = 0;
  constructor(private settings: Settings) {}
  private safe(fn: () => void) {
    try {
      fn();
    } catch {
      this.stop();
      this.diagnostics.reason =
        "Stopped safely after an observer or layout error";
    }
  }
  async start() {
    if (this.running) return;
    if (!this.settings.enabled) {
      this.diagnostics.reason = "Disabled";
      return;
    }
    if (!CSS.supports("content-visibility", "auto")) {
      this.diagnostics.reason = "Browser lacks content-visibility support";
      return;
    }
    try {
      this.running = true;
      this.listeners = new AbortController();
      this.mutations = new MutationObserver((records) =>
        this.safe(() => this.onMutations(records)),
      );
      this.mutations.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-testid", "data-message-author-role"],
      });
      // Text changes are observed only within confidently identified turns, never composer/global character data.
      this.textMutations = new MutationObserver((records) =>
        this.safe(() => this.onMutations(records)),
      );
      this.resize = new ResizeObserver((entries) =>
        this.safe(() => {
          let resetReason = "";
          for (const entry of entries) {
            if (entry.target === this.root || entry.target === this.scroller) {
              const previous =
                entry.target === this.root
                  ? this.rootWidth
                  : this.scrollerWidth;
              if (
                previous > 0 &&
                Math.abs(entry.contentRect.width - previous) >
                  CONFIG.widthTolerance
              )
                resetReason = "Conversation/scroller width changed";
              if (entry.target === this.root)
                this.rootWidth = entry.contentRect.width;
              else this.scrollerWidth = entry.contentRect.width;
            } else {
              const record = this.registry.get(entry.target as HTMLElement);
              if (
                record &&
                record.lastMeasuredWidth > 0 &&
                Math.abs(entry.contentRect.width - record.lastMeasuredWidth) >
                  CONFIG.widthTolerance
              )
                resetReason = "Turn column width changed";
              if (
                record &&
                record.mode !== "parked" &&
                entry.contentRect.height > 0
              ) {
                record.lastMeasuredHeight = entry.contentRect.height;
                record.lastMeasuredWidth = entry.contentRect.width;
              }
            }
          }
          if (resetReason) this.resetLayout(resetReason);
          this.schedule();
        }),
      );
      this.safe(() => this.discover());
      if (!this.running) return;
      this.timer = window.setInterval(
        () =>
          this.safe(() => {
            if (
              location.href !== this.url ||
              (this.root && !this.root.isConnected)
            )
              this.discover();
            else if (!this.root && performance.now() >= this.nextRetry)
              this.discover();
            else if (
              this.root &&
              this.adapter.findScrollRoot(
                this.root,
                this.registry.ordered[0]?.el,
              ) !== this.scroller
            )
              this.discover();
          }),
        2000,
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            ["f", "p"].includes(event.key.toLowerCase())
          )
            this.restoreAll();
        },
        { capture: true, signal: this.listeners.signal },
      );
      window.addEventListener(
        "beforeprint",
        () => {
          this.printing = true;
          this.restoreAll();
        },
        { signal: this.listeners.signal },
      );
      window.addEventListener(
        "afterprint",
        () => {
          this.printing = false;
          this.restoreAll();
        },
        { signal: this.listeners.signal },
      );
      document.addEventListener(
        "selectionchange",
        () =>
          this.safe(() => {
            if (!document.getSelection()?.isCollapsed) this.restoreAll();
            else this.schedule();
          }),
        { signal: this.listeners.signal },
      );
      document.addEventListener(
        "focusin",
        () =>
          this.safe(() => {
            for (const record of this.registry.ordered)
              if (record.el.contains(document.activeElement))
                setMode(record, "normal");
            this.schedule();
          }),
        { signal: this.listeners.signal },
      );
      // Resource completion may change an off-screen turn without a DOM mutation.
      document.addEventListener(
        "load",
        (event) =>
          this.safe(() => {
            const el =
              event.target instanceof Node
                ? this.adapter.findTurnFromNode(event.target)
                : null;
            const record = el ? this.registry.get(el) : undefined;
            if (record) {
              record.lastMutationAt = performance.now();
              setMode(record, "normal");
              record.lastMeasuredHeight = 0;
              this.schedule();
              clearTimeout(this.hotTimer);
              this.hotTimer = window.setTimeout(
                () => this.schedule(),
                CONFIG.hotMutationMs + 50,
              );
            }
          }),
        { capture: true, signal: this.listeners.signal },
      );
      document.fonts?.addEventListener(
        "loadingdone",
        () => this.safe(() => this.resetLayout("Fonts changed")),
        { signal: this.listeners.signal },
      );
      window.addEventListener(
        "resize",
        () => this.safe(() => this.resetLayout("Viewport changed")),
        { signal: this.listeners.signal },
      );
    } catch {
      this.stop();
      this.diagnostics.reason = "Stopped safely during initialization";
    }
  }
  private onMutations(records: MutationRecord[]) {
    this.diagnostics.observerEvents += records.length;
    let structural = false;
    for (const mutation of records) {
      let el =
        mutation.target instanceof HTMLElement
          ? mutation.target
          : mutation.target.parentElement;
      let record: TurnRecord | undefined;
      while (el && !record) {
        record = this.registry.get(el);
        el = el.parentElement;
      }
      if (record) {
        record.lastMutationAt = performance.now();
        if (record.mode === "parked") {
          setMode(record, "normal");
          record.lastMeasuredHeight = 0;
        }
      } else if (mutation.type === "childList") {
        if (!this.root?.isConnected) structural = true;
        else if (!this.root.contains(mutation.target)) {
          if (
            [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
              this.adapter.hasStructuralSignal(node),
            )
          )
            structural = true;
        } else
          for (const node of mutation.addedNodes)
            if (node instanceof HTMLElement) this.added.add(node);
      }
      if (
        mutation.type === "attributes" ||
        (record &&
          mutation.type === "childList" &&
          [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            this.adapter.hasStructuralSignal(node),
          ) &&
          !this.adapter.valid(record.el))
      )
        structural = true;
    }
    let removed = false;
    for (const record of this.registry.ordered)
      if (!record.el.isConnected) {
        setMode(record, "normal");
        this.resize?.unobserve(record.el);
        this.intersection?.unobserve(record.el);
        removed = true;
      }
    this.registry.prune();
    if (removed) {
      this.textMutations?.disconnect();
      for (const record of this.registry.ordered)
        this.textMutations?.observe(record.el, {
          characterData: true,
          subtree: true,
        });
    }
    this.needsDiscovery ||=
      structural && (!!this.root || performance.now() >= this.nextRetry);
    if (this.needsDiscovery || this.added.size)
      this.scheduler.idleTask(() =>
        this.safe(() => {
          if (this.needsDiscovery) {
            this.needsDiscovery = false;
            this.added.clear();
            this.discover();
          } else this.registerAdded();
        }),
      );
    this.schedule();
    clearTimeout(this.hotTimer);
    this.hotTimer = window.setTimeout(
      () => this.schedule(),
      CONFIG.hotMutationMs + 50,
    );
  }
  private registerAdded() {
    if (!this.root?.isConnected) {
      this.discover();
      return;
    }
    const candidates = new Set<HTMLElement>();
    for (const subtree of this.added)
      if (subtree.isConnected && this.root.contains(subtree))
        for (const el of this.adapter.findAddedTurns(subtree))
          candidates.add(el);
    this.added.clear();
    const eligible = [...candidates].filter(
      (el) => !this.registry.get(el) && !hasConflict(el),
    );
    for (const el of eligible) {
      this.registry.add(el);
      this.resize?.observe(el);
      this.textMutations?.observe(el, { characterData: true, subtree: true });
      this.intersection?.observe(el);
    }
    this.registry.sort();
    this.schedule();
  }
  private discover() {
    if (!this.running) return;
    const root = this.adapter.findConversationRoot();
    const scroller = root ? this.adapter.findScrollRoot(root) : null;
    const changed =
      root !== this.root ||
      scroller !== this.scroller ||
      this.url !== location.href;
    this.url = location.href;
    if (changed) {
      this.releaseRoot();
      this.root = root;
      this.scroller = scroller;
    }
    if (!root) {
      this.diagnostics.rootFound = false;
      this.diagnostics.managed = 0;
      this.diagnostics.parked = 0;
      this.diagnostics.reason = "Inactive: no confident conversation structure";
      this.nextRetry = performance.now() + this.retryDelay;
      this.retryDelay = Math.min(30000, this.retryDelay * 2);
      return;
    }
    this.retryDelay = 500;
    const turns = this.adapter.findTurns(root);
    const found = new Set(turns);
    this.textMutations?.disconnect();
    for (const record of this.registry.ordered)
      if (!found.has(record.el)) {
        setMode(record, "normal");
        this.resize?.unobserve(record.el);
        this.registry.forget(record.el);
      }
    this.registry.ordered = this.registry.ordered.filter((r) =>
      found.has(r.el),
    );
    const eligible = turns.filter(
      (el) => !this.registry.get(el) && !hasConflict(el),
    ); // all reads before writes
    for (const el of eligible) {
      this.registry.add(el);
      this.resize?.observe(el);
      this.textMutations?.observe(el, { characterData: true, subtree: true });
    }
    for (const record of this.registry.ordered)
      this.textMutations?.observe(record.el, {
        characterData: true,
        subtree: true,
      });
    this.registry.sort();
    this.intersection?.disconnect();
    const height = scroller
      ? scrollViewport(scroller).bottom - scrollViewport(scroller).top
      : innerHeight;
    this.intersection = new IntersectionObserver(() => this.schedule(), {
      root: scroller === document.scrollingElement ? null : scroller,
      rootMargin: `${height * this.settings.restoreBufferScreens}px 0px`,
    });
    for (const record of this.registry.ordered)
      this.intersection.observe(record.el);
    if (changed) {
      this.rootWidth = measure(root).width;
      this.scrollerWidth = scroller ? measure(scroller).width : 0;
      this.resize?.observe(root);
      if (scroller && scroller !== root) this.resize?.observe(scroller);
      const target = scroller === document.scrollingElement ? window : scroller;
      target?.addEventListener("scroll", this.onScroll, {
        passive: true,
        signal: this.listeners?.signal,
      });
    }
    this.diagnostics.rootFound = true;
    this.diagnostics.reason = "Active";
    this.schedule();
    clearTimeout(this.hotTimer);
    this.hotTimer = window.setTimeout(
      () => this.schedule(),
      CONFIG.hotMutationMs + 50,
    );
  }
  private onScroll = () => this.schedule();
  private schedule() {
    if (this.running)
      this.scheduler.frameTask(() => this.safe(() => this.batch()));
  }
  private batch() {
    const start = performance.now();
    if (!this.root?.isConnected) return;
    const records = this.registry.ordered;
    const viewport = scrollViewport(this.scroller!);
    const restore =
      (viewport.bottom - viewport.top) * this.settings.restoreBufferScreens;
    let near = 0;
    const park =
      (viewport.bottom - viewport.top) * this.settings.parkBufferScreens;
    const now = performance.now();
    if (
      !this.printing &&
      this.suspendedUntil > 0 &&
      now >= this.suspendedUntil
    ) {
      this.suspendedUntil = 0;
      this.diagnostics.reason = "Active";
    }
    const selected =
      !!document.getSelection() && !document.getSelection()!.isCollapsed;
    const readings = records.map((record, index) => ({
      record,
      distance: viewportDistance(record.el.getBoundingClientRect(), viewport),
      size: record.mode === "normal" ? measure(record.el) : null,
      focused: record.el.contains(document.activeElement),
      protected: index >= records.length - CONFIG.protectedTailTurns,
    }));
    for (const {
      record,
      size,
      distance,
      focused,
      protected: protect,
    } of readings) {
      record.isProtected = protect;
      if (distance <= restore) {
        near++;
        record.lastVisibleAt = performance.now();
      }
      if (size) {
        record.lastMeasuredHeight = size.height;
        record.lastMeasuredWidth = size.width;
      }
      setMode(
        record,
        nextMode(record.mode, {
          enabled: this.settings.enabled,
          strong: this.settings.mode === "strong",
          distance,
          restore,
          park,
          protected: protect,
          focused,
          selected,
          hot: now - record.lastMutationAt < CONFIG.hotMutationMs,
          height: record.lastMeasuredHeight,
          suspended: this.printing || now < this.suspendedUntil,
        }),
      );
    }
    this.diagnostics.near = near;
    this.diagnostics.parked = records.filter((r) => r.mode === "parked").length;
    this.diagnostics.managed = records.length;
    this.diagnostics.cachedHeights = records.filter(
      (r) => r.lastMeasuredHeight > 0,
    ).length;
    this.diagnostics.lastBatchMs = performance.now() - start;
  }
  private resetLayout(reason: string) {
    for (const record of this.registry.ordered) {
      setMode(record, "normal");
      record.lastMeasuredHeight = 0;
      record.lastMeasuredWidth = 0;
    }
    // Messages from the popup can arrive before the next animation frame.
    this.diagnostics.parked = 0;
    this.diagnostics.cachedHeights = 0;
    this.diagnostics.reason = reason;
    this.schedule();
  }
  private releaseRoot() {
    const target =
      this.scroller === document.scrollingElement ? window : this.scroller;
    target?.removeEventListener("scroll", this.onScroll);
    this.resize?.disconnect();
    this.textMutations?.disconnect();
    this.intersection?.disconnect();
    for (const record of this.registry.ordered) setMode(record, "normal");
    this.registry.clear();
    this.added.clear();
    this.needsDiscovery = false;
    this.root = null;
    this.scroller = null;
  }
  stop() {
    this.running = false;
    this.mutations?.disconnect();
    this.listeners?.abort();
    this.releaseRoot();
    clearInterval(this.timer);
    clearTimeout(this.hotTimer);
    clearTimeout(this.resumeTimer);
    this.scheduler.stop();
    this.diagnostics = emptyDiagnostics();
    this.diagnostics.reason = "Disabled";
    this.printing = false;
    this.suspendedUntil = 0;
  }
  restoreAll() {
    if (!this.running) return;
    this.suspendedUntil = performance.now() + CONFIG.resumeMs;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(
      () => this.schedule(),
      CONFIG.resumeMs + 50,
    );
    this.resetLayout("Restored; optimization paused for 30 seconds");
  }
  updateSettings(settings: Settings) {
    this.stop();
    this.settings = settings;
    void this.start();
  }
  getDiagnostics() {
    return { ...this.diagnostics };
  }
}
