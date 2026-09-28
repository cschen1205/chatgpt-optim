export type TurnMode = "normal" | "auto" | "parked";
export interface TurnRecord {
  el: HTMLElement;
  mode: TurnMode;
  lastMeasuredHeight: number;
  lastMeasuredWidth: number;
  lastMutationAt: number;
  lastVisibleAt: number;
  isProtected: boolean;
  isConnected: boolean;
}
export class TurnRegistry {
  private lookup = new WeakMap<HTMLElement, TurnRecord>();
  ordered: TurnRecord[] = [];
  get(el: HTMLElement) {
    return this.lookup.get(el);
  }
  add(el: HTMLElement) {
    const existing = this.get(el);
    if (existing) return existing;
    const record: TurnRecord = {
      el,
      mode: "normal",
      lastMeasuredHeight: 0,
      lastMeasuredWidth: 0,
      lastMutationAt: performance.now(),
      lastVisibleAt: 0,
      isProtected: false,
      isConnected: true,
    };
    this.lookup.set(el, record);
    this.ordered.push(record);
    return record;
  }
  forget(el: HTMLElement) {
    this.lookup.delete(el);
  }
  prune() {
    this.ordered = this.ordered.filter((r) => {
      r.isConnected = r.el.isConnected;
      if (!r.isConnected) this.lookup.delete(r.el);
      return r.isConnected;
    });
  }
  sort() {
    this.ordered.sort((a, b) =>
      a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
  }
  clear() {
    this.ordered = [];
    this.lookup = new WeakMap();
  }
}
