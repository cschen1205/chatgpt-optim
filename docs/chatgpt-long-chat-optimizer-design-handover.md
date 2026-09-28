# ChatGPT Long-Conversation Optimizer
## Design & Engineering Handover

**Status:** Implementation-ready design  
**Target:** Chrome / Chromium, Manifest V3  
**Primary site:** `https://chatgpt.com/*`  
**Legacy compatibility:** `https://chat.openai.com/*`  
**Implementation goal:** Improve responsiveness of very long ChatGPT conversations by reducing off-screen rendering/layout work without deleting conversation DOM, touching ChatGPT application state, intercepting requests, or storing message content.

---

## 1. Executive Summary

Long ChatGPT conversations can become slow because the browser may need to maintain, style, lay out, and paint a very large page containing many complex message trees.

This extension should act only as a **presentation-layer optimizer**.

The design is based on **viewport-aware rendering optimization**, not message count:

- A short message and a 5,000-line response are not treated as equal-sized units.
- The active region is measured in **pixels / viewport heights**.
- Content near the viewport remains fully usable.
- Far-away historical content is allowed to skip rendering work.
- When the user scrolls upward, old content becomes active before it reaches the visible viewport.
- A single very large message that overlaps the viewport remains active; it is not hidden just because it is an "old message".

### Core safety rule

> Never delete, detach, replace, or rewrite ChatGPT-owned message subtrees in v1.

The extension must not call `.remove()`, replace `innerHTML`, move React-owned children into `DocumentFragment`, access React internals, intercept ChatGPT network requests, or alter ChatGPT conversation state.

The safest optimization is CSS `content-visibility: auto`. A stronger opt-in mode may use `content-visibility: hidden` only for messages far outside the active viewport buffer while preserving their intrinsic block size.

---

## 2. Product Goals

### 2.1 Goals

1. Make very long ChatGPT conversations smoother to scroll and interact with.
2. Keep historical messages available when the user scrolls back.
3. Avoid visible scroll jumps.
4. Avoid depending on the number of messages.
5. Avoid modifying ChatGPT data or application state.
6. Use minimal Chrome permissions.
7. Fail safely if ChatGPT changes its DOM.
8. Keep the implementation small enough to maintain when the ChatGPT frontend changes.

### 2.2 Non-goals

The extension must **not**:

- change what conversation context ChatGPT sends to its backend;
- intercept `fetch`, XHR, WebSocket, EventSource, or form submission;
- inspect or modify the text typed in the composer;
- remove old messages from ChatGPT's DOM;
- manipulate React/Vue/internal application objects;
- persist conversation text;
- summarize or alter messages;
- change ChatGPT APIs;
- optimize the sidebar or unrelated pages in v1;
- support non-Chromium browsers in v1.

---

## 3. Important Design Principle: Pixel-Based, Not Message-Based

Do **not** use rules such as:

```text
Keep last 30 messages
Hide messages 1-100
```

Message lengths vary too much.

Instead define an active rendering region around the current viewport.

Example:

```text
                 FAR ABOVE
          rendering may be skipped
                       |
                       |
        +-----------------------------+
        |      RESTORE BUFFER         |  ~3 viewport heights
        |                             |
        |   +---------------------+   |
        |   |      VIEWPORT       |   |
        |   +---------------------+   |
        |                             |
        |      RESTORE BUFFER         |  ~3 viewport heights
        +-----------------------------+
                       |
                       |
                 FAR BELOW
          rendering may be skipped
```

Recommended defaults:

```text
restore distance:       3 viewport heights
park distance:          5 viewport heights
hysteresis:             2 viewport heights
protected live tail:    latest 2 turns
```

The different restore and park thresholds provide hysteresis and prevent constant mode switching when an element sits near a boundary.

---

## 4. User Experience

### 4.1 Expected behavior

At the bottom of a long conversation:

```text
Old history       -> optimized/off-screen
Recent history    -> active
Current viewport  -> active
Newest messages   -> always protected
```

When scrolling upward:

```text
1. User scrolls toward old content.
2. The message enters the restore buffer.
3. Extension restores normal rendering before it becomes visible.
4. User sees the original ChatGPT message normally.
5. When the message becomes far away again, it may be optimized again.
```

There should be no explicit "load old messages" interaction.

### 4.2 Huge-message behavior

If one response is extremely tall, for example 20,000 px:

```text
+----------------------------+
| message start              |
|                            |
|     [viewport here]        |
|                            |
|                            |
| message continues          |
+----------------------------+
```

Because the message intersects the active region, keep the **entire message container active**.

Do not implement paragraph-level, code-block-level, or child-level virtualization in v1.

This intentionally trades some performance for much lower compatibility risk.

---

## 5. Optimization Modes

Implement two modes.

### 5.1 Balanced Mode — Default

Use browser-native rendering skipping:

```css
content-visibility: auto;
contain-intrinsic-size: auto 600px;
```

Apply it to eligible conversation-turn containers.

Properties of Balanced Mode:

- DOM remains intact.
- ChatGPT still owns every child.
- No message subtree is detached.
- Browser decides when off-screen rendering can be skipped.
- Off-screen content remains available to normal browser features such as find-in-page according to browser support.
- Lowest compatibility risk.

The `600px` value is only an initial fallback. Once the extension measures a turn, store the measured block size and use that as the fallback intrinsic size where practical.

### 5.2 Strong Mode — Opt-in / Experimental

For elements **well outside** the viewport buffer:

```css
content-visibility: hidden;
contain-intrinsic-size: auto var(--lcopt-height);
```

Before parking a turn:

1. Measure its rendered block height.
2. Cache the height.
3. Set the intrinsic-size fallback.
4. Mark the element as parked.
5. Do not remove or mutate its children.

Before the user reaches it:

1. Switch back to `content-visibility: auto`.
2. Allow rendering.
3. Re-measure using `ResizeObserver`.
4. Update cached height.

Strong Mode must be clearly labeled experimental because `content-visibility: hidden` can affect browser features such as find-in-page, tab navigation, selection, and accessibility while content is parked.

### 5.3 Explicitly forbidden v1 mode

Do not implement DOM subtree detachment:

```js
// FORBIDDEN
element.remove();

// FORBIDDEN
element.innerHTML = "";

// FORBIDDEN
fragment.append(...element.children);

// FORBIDDEN
element.replaceChildren(...);
```

Even if this reduces DOM memory more aggressively, it can conflict with React reconciliation, event handlers, references, and future ChatGPT UI updates.

---

## 6. Architecture

```text
+----------------------------------------------------+
| Chrome Extension                                  |
|                                                    |
|  +----------------+        +--------------------+  |
|  | Popup / Config |------->| chrome.storage     |  |
|  +----------------+        +---------+----------+  |
|                                      |             |
|                                      v             |
|  +------------------------------------------------+|
|  | Content Script                                 ||
|  |                                                ||
|  |  +------------------+                          ||
|  |  | DOM Adapter      |                          ||
|  |  | - root detection |                          ||
|  |  | - turn detection |                          ||
|  |  | - scroll root    |                          ||
|  |  +--------+---------+                          ||
|  |           |                                    ||
|  |           v                                    ||
|  |  +------------------+     +-----------------+   ||
|  |  | Turn Registry    |<--->| ResizeObserver  |   ||
|  |  +--------+---------+     +-----------------+   ||
|  |           |                                    ||
|  |           v                                    ||
|  |  +------------------+     +-----------------+   ||
|  |  | Virtualization   |<--->| Intersection /  |   ||
|  |  | Controller       |     | viewport logic  |   ||
|  |  +--------+---------+     +-----------------+   ||
|  |           |                                    ||
|  |           v                                    ||
|  |  +------------------+                          ||
|  |  | Style Controller |                          ||
|  |  +------------------+                          ||
|  |                                                ||
|  |  MutationObserver -> discover new turns        ||
|  +------------------------------------------------+|
+----------------------------------------------------+

             interacts only with presentation DOM
                          |
                          v
+----------------------------------------------------+
| ChatGPT page / React application                   |
+----------------------------------------------------+
```

---

## 7. Recommended Project Structure

Use a small dependency-light project.

```text
chatgpt-long-chat-optimizer/
├── manifest.json
├── package.json
├── README.md
├── src/
│   ├── content/
│   │   ├── index.ts
│   │   ├── dom-adapter.ts
│   │   ├── turn-registry.ts
│   │   ├── virtualizer.ts
│   │   ├── scheduler.ts
│   │   ├── settings.ts
│   │   ├── diagnostics.ts
│   │   └── styles.css
│   └── popup/
│       ├── popup.html
│       ├── popup.ts
│       └── popup.css
├── tests/
│   ├── fixtures/
│   │   └── long-chat.html
│   ├── dom-adapter.test.ts
│   ├── virtualizer.test.ts
│   └── e2e/
│       └── long-chat.spec.ts
└── dist/
```

Suggested implementation stack:

- Manifest V3
- TypeScript
- small bundler such as esbuild
- no UI framework
- Vitest or equivalent for unit tests
- Playwright for synthetic long-page E2E tests

Do not add React/Vue/Svelte merely for the popup.

---

## 8. Chrome Manifest

Use the minimum possible permissions.

Conceptual manifest:

```json
{
  "manifest_version": 3,
  "name": "ChatGPT Long Chat Optimizer",
  "version": "0.1.0",
  "description": "Improves rendering performance of very long ChatGPT conversations.",
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*"
      ],
      "js": ["content.js"],
      "css": ["content.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

A service worker should **not** be added unless an implementation requirement actually needs one.

No `tabs`, `webRequest`, `scripting`, broad host permissions, or remote-code permissions are required for the initial design.

---

## 9. DOM Adapter

The DOM structure of ChatGPT is private implementation detail and can change.

All selectors must therefore live behind one adapter.

Recommended interface:

```ts
interface ChatGPTDomAdapter {
  findConversationRoot(): HTMLElement | null;
  findScrollRoot(conversationRoot: HTMLElement): HTMLElement | null;
  findTurns(conversationRoot: HTMLElement): HTMLElement[];
  findTurnFromNode(node: Node): HTMLElement | null;
  isComposerRelated(el: HTMLElement): boolean;
}
```

### 9.1 Selector strategy

Prefer stable semantic attributes when available.

Possible signals, in priority order:

```text
1. data-testid values representing conversation turns
2. data-message-author-role
3. semantic <article> wrappers
4. validated structural fallback
```

Do not depend primarily on generated class names or Tailwind class combinations.

Example candidate selectors may include:

```css
[data-testid^="conversation-turn-"]
[data-message-author-role]
article
```

These are **candidate signals**, not a contract. Codex must inspect the current DOM during implementation and isolate any site-specific logic inside `dom-adapter.ts`.

### 9.2 Turn-container selection

If `data-message-author-role` is on an inner content element, prefer the nearest stable parent representing the whole turn.

A turn candidate should:

- be inside the conversation root;
- not be inside the composer;
- represent one logical user/assistant turn;
- have substantial width relative to the conversation column;
- not contain several independent conversation turns;
- appear in document order with other turns.

### 9.3 Confidence / fail-safe behavior

If the adapter cannot confidently identify the conversation:

```text
DO NOTHING.
```

Never guess aggressively.

A ChatGPT frontend update should degrade into "extension temporarily inactive", not into broken page behavior.

---

## 10. Turn Registry

Maintain a `WeakMap` plus an ordered collection for currently connected turns.

Suggested record:

```ts
type TurnMode = "normal" | "auto" | "parked";

interface TurnRecord {
  el: HTMLElement;
  mode: TurnMode;

  lastMeasuredHeight: number;
  lastMeasuredWidth: number;

  lastMutationAt: number;
  lastVisibleAt: number;

  isProtected: boolean;
  isConnected: boolean;
}
```

Use `WeakMap<HTMLElement, TurnRecord>` for lookup so detached page nodes are not kept alive accidentally.

Do not store message text.

Do not use message text as an identifier.

---

## 11. Observers

### 11.1 MutationObserver

Purpose:

- detect new conversation turns;
- detect SPA conversation replacement;
- mark actively changing turns as hot/protected.

Important:

- observe `childList` and `subtree`;
- avoid observing `characterData` globally;
- debounce/batch processing;
- process added nodes incrementally;
- do not rescan the entire page on every token streamed by ChatGPT.

Recommended behavior:

```text
Mutation arrives
    |
    +-> Does added subtree contain a possible new turn?
            |
            +-> yes -> register it
            +-> no  -> ignore
```

For an already registered turn, a mutation inside it should update:

```text
lastMutationAt = performance.now()
```

A recently mutating turn should not be parked.

Suggested hot period:

```text
3 seconds after last mutation
```

### 11.2 ResizeObserver

Observe active/visible turn containers.

Use it to update cached rendered heights.

Also observe the conversation/scroller width.

If conversation width changes materially, for example because:

- browser window resized;
- sidebar opened/closed;
- browser zoom changed;
- ChatGPT layout changed;

then invalidate cached heights.

Recommended recovery:

```text
1. Restore all parked elements.
2. Clear stale height caches.
3. Wait for layout to settle.
4. Re-measure.
5. Resume optimization.
```

This is safer than trying to mathematically scale cached heights.

### 11.3 IntersectionObserver

Use it to determine when turns approach the active region.

Recommended initial root margin:

```text
300% 0px 300% 0px
```

However, the controller should also support explicit pixel-distance checks because Strong Mode needs separate restore and park thresholds for hysteresis.

Do not run expensive `getBoundingClientRect()` loops on every raw scroll event.

---

## 12. Virtualization State Machine

Each eligible turn has three states:

```text
NORMAL
  |
  | extension enabled
  v
AUTO
  |
  | far outside park threshold
  | Strong Mode only
  v
PARKED
  |
  | approaches restore threshold
  v
AUTO
```

### 12.1 `NORMAL`

No extension-specific rendering property is active.

Used when:

- extension disabled;
- page unsupported;
- cleanup in progress.

### 12.2 `AUTO`

Apply:

```css
content-visibility: auto;
```

and a cached/fallback intrinsic size.

This is the normal Balanced Mode state.

### 12.3 `PARKED`

Strong Mode only.

Apply:

```css
content-visibility: hidden;
contain-intrinsic-size: auto var(--lcopt-height);
```

Never park if any of these are true:

- element intersects restore buffer;
- element is one of the latest protected turns;
- element mutated recently;
- height is unknown or invalid;
- element currently contains focus;
- selection intersects the element;
- conversation layout is being resized/rebuilt.

---

## 13. Viewport Distance Algorithm

Primary rule:

> Decide from geometry, not turn index.

Definitions:

```ts
const viewportHeight = scrollRoot.clientHeight;

const restoreDistancePx =
  settings.restoreBufferScreens * viewportHeight; // default 3x

const parkDistancePx =
  settings.parkBufferScreens * viewportHeight;    // default 5x
```

For each candidate:

```text
distanceAbove = viewportTop - turnBottom
distanceBelow = turnTop - viewportBottom
distance = max(distanceAbove, distanceBelow, 0)
```

Rules:

```text
distance <= restoreDistance:
    ensure AUTO / rendered

distance >= parkDistance:
    may PARK if eligible and Strong Mode

between restoreDistance and parkDistance:
    keep existing state
```

That middle band is intentional hysteresis.

### 13.1 Why this works with huge messages

A 20,000 px message that spans the viewport has:

```text
distance = 0
```

so it stays active.

No special "long message count" heuristic is required.

---

## 14. Protected Live Tail

The primary system is geometry-based, but keep a small **safety-only** protected tail.

Default:

```text
latest 2 conversation turns
```

Reason:

- current assistant output may stream;
- tool results may continue changing;
- citations/buttons may be inserted after initial rendering;
- ChatGPT may update controls around the current interaction.

This is not the primary virtualization policy and should not be increased into a "keep last N messages" architecture.

---

## 15. Style Application

Never overwrite ChatGPT's complete `style` attribute or class list.

Use extension-specific CSS classes and CSS custom properties.

Example:

```css
.lcopt-auto {
  content-visibility: auto !important;
  contain-intrinsic-size: auto var(--lcopt-height, 600px);
}

.lcopt-parked {
  content-visibility: hidden !important;
  contain-intrinsic-size: auto var(--lcopt-height, 600px);
}
```

Set only:

```text
--lcopt-height
lcopt-auto
lcopt-parked
data-lcopt-managed
```

Before applying an extension property, capture whether ChatGPT itself already defines a conflicting inline property.

On cleanup, remove only extension-owned classes, data attributes, and CSS variables.

Do not remove unrelated ChatGPT styles.

---

## 16. Scheduling and Main-Thread Discipline

The extension itself must not become another source of lag.

Rules:

1. No expensive work in raw `scroll` callbacks.
2. Batch mutation processing.
3. Use `requestAnimationFrame()` for geometry reads/writes that must align with layout.
4. Use `requestIdleCallback()` for non-urgent scans/diagnostics, with a timeout fallback.
5. Separate layout reads from writes to avoid forced synchronous layout.
6. Do not repeatedly count all descendant DOM nodes in the hot path.
7. Do not continuously query the whole document with broad selectors.

Preferred pattern:

```text
observer event
    |
queue element IDs
    |
one scheduled batch
    |
READ PHASE
  - geometry
  - state
    |
WRITE PHASE
  - classes
  - CSS variables
```

---

## 17. SPA Navigation and Conversation Switching

ChatGPT is a single-page application.

The content script may remain alive when the user changes conversation.

The controller must detect when:

- the old conversation root disconnects;
- a different conversation root appears;
- the URL changes;
- the scroll container changes.

On conversation replacement:

```text
1. Disconnect observers tied to old root.
2. Clean extension styles from old managed elements when possible.
3. Clear ordered registry.
4. Find new conversation root.
5. Register current turns.
6. Resume optimization.
```

Do not rely only on page reload.

---

## 18. Search, Print, Selection, Focus, and Accessibility

### 18.1 Balanced Mode

`content-visibility: auto` is the default because it preserves much more normal browser behavior for off-screen content.

### 18.2 Strong Mode compatibility safeguards

Because parked `content-visibility: hidden` content may not participate normally in find-in-page or keyboard navigation:

On these shortcuts/events, temporarily restore all parked content:

```text
Ctrl/Cmd + F    -> restore all before browser search
Ctrl/Cmd + P    -> restore all before print
beforeprint     -> restore all
```

After a reasonable idle period or after the user resumes normal scrolling, Strong Mode may gradually re-apply optimization.

Do **not** prevent default browser shortcuts.

### 18.3 Focus

Never park an element if:

```js
turn.contains(document.activeElement)
```

### 18.4 Selection

If the current selection intersects a turn, do not park it.

A conservative implementation may suspend Strong Mode while a non-collapsed selection exists.

### 18.5 Accessibility

Balanced Mode is the recommended mode for accessibility-sensitive use.

Strong Mode should be labeled experimental because parked content can be temporarily unavailable to browser/user-agent accessibility behavior.

---

## 19. Settings

Recommended popup:

```text
ChatGPT Long Chat Optimizer
--------------------------------

[✓] Enable optimization

Mode
(o) Balanced — Recommended
( ) Strong — Experimental

Active buffer
[ 3 ] screens

Strong-mode park distance
[ 5 ] screens

[ Restore all now ]

Status
Managed turns: 184
Active/near:    11
Parked:         173
```

Do not expose too many tuning parameters in v1.

### Persisted settings

```ts
interface Settings {
  enabled: boolean;
  mode: "balanced" | "strong";
  restoreBufferScreens: number; // default 3
  parkBufferScreens: number;    // default 5
  debug: boolean;               // default false
}
```

Use `chrome.storage.local` or `chrome.storage.sync`.

No conversation data should be stored.

---

## 20. Privacy and Security Requirements

### Required

- No telemetry in v1.
- No analytics SDK.
- No remote script.
- No remote configuration.
- No message text persisted.
- No message text sent anywhere.
- No request interception.
- No cookies read.
- No authentication data read.
- No clipboard access.
- No history permission.
- No broad `<all_urls>` match.

### Extension should only derive

- DOM element references;
- element geometry;
- mutation timestamps;
- viewport size;
- numeric diagnostic counts;
- user settings.

---

## 21. Diagnostics

Debug mode may expose a small overlay or console diagnostics.

Suggested metrics:

```text
conversation root found: yes/no
turns detected
turns managed
turns near viewport
turns parked
cached heights
observer event rate
last layout reset reason
```

Do not log:

- message body text;
- prompts;
- assistant responses;
- uploaded-file contents.

Avoid expensive continuous "total DOM node count" measurement.

If needed for a benchmark, compute it only when the user explicitly opens diagnostics.

---

## 22. Cleanup / Disable Behavior

When the extension is disabled from the popup:

```text
1. Restore every managed turn.
2. Remove lcopt-auto.
3. Remove lcopt-parked.
4. Remove --lcopt-height.
5. Remove data-lcopt-* attributes.
6. Disconnect observers.
7. Stop scheduled optimization tasks.
```

Disabling should return the page to normal without requiring a reload.

If cleanup cannot complete because ChatGPT replaced the DOM, disconnected nodes may simply be released.

---

## 23. Error Handling

All failures should be fail-open:

```text
Selector changed?
-> Stop optimizing.

Unexpected element structure?
-> Ignore that element.

Measurement is zero/NaN?
-> Do not park.

Observer throws?
-> Restore managed elements and disable controller for current page.

ChatGPT already uses content-visibility?
-> Do not blindly overwrite; detect conflict and skip or preserve original value.
```

The extension should never repeatedly retry at high frequency after a structural failure.

Use an exponential or bounded retry strategy for root detection.

---

## 24. Performance Expectations

Important:

> `content-visibility` reduces layout/rendering/painting work but does not physically remove DOM nodes.

Therefore v1 should not claim that it reduces raw DOM-node count or all memory usage.

The expected gains are mainly:

- less off-screen layout work;
- less paint work;
- lower rendering cost during scrolling;
- fewer expensive operations involving far-off content.

If performance is still insufficient after v1, evaluate a separate v2 design. Do **not** silently escalate v1 into React-owned subtree detachment.

### Suggested benchmark goals

Use a synthetic fixture with approximately:

```text
300-800 conversation turns
50,000-150,000 descendant DOM nodes
mixed short and very long turns
code blocks
tables
images/placeholders
```

Measure:

- scroll responsiveness;
- main-thread long tasks;
- style/layout duration;
- paint duration;
- extension CPU overhead;
- visible scroll jumps.

Suggested acceptance targets:

```text
No extension-caused long task > 100 ms during steady scrolling
No persistent scroll-position jumps > ~10 px
No missing visible messages
No console error caused by extension during normal use
Meaningful reduction in rendering/layout cost on synthetic long-chat test
```

Do not make a hard percentage improvement a release blocker because actual benefit depends on Chrome version, hardware, and ChatGPT page structure.

---

## 25. Test Plan

### 25.1 Unit tests

#### DOM adapter

- detects synthetic conversation root;
- identifies turns;
- ignores composer;
- does not duplicate nested candidate nodes;
- fails safely when attributes are missing.

#### Distance logic

Test:

```text
turn visible
turn 1 screen above
turn 4 screens above
turn 8 screens above
turn 8 screens below
huge turn containing viewport
zero-height turn
```

#### State transitions

```text
normal -> auto
auto -> parked
parked -> auto
parked -> normal on disable
```

#### Protection rules

Do not park:

- newest protected turns;
- focused turn;
- selected turn;
- recently mutating turn;
- unknown-height turn.

### 25.2 Synthetic E2E fixture

Create `tests/fixtures/long-chat.html` containing:

- hundreds of conversation-like turns;
- random-looking but deterministic heights;
- very large Markdown-like blocks;
- code blocks;
- tables;
- images/placeholders;
- one exceptionally tall message.

E2E tests should verify:

1. extension initializes;
2. far content enters correct state;
3. scrolling upward restores content before visibility;
4. scroll position remains stable;
5. huge intersecting message is not parked;
6. resize resets cached geometry safely;
7. disabling restores page;
8. Ctrl/Cmd+F triggers Strong Mode restoration;
9. print restoration works.

### 25.3 Manual ChatGPT smoke test

Test on a disposable long conversation.

Verify:

- new user message can be sent;
- assistant streaming remains normal;
- tool calls/citations render;
- old messages can be scrolled to;
- code-copy buttons work;
- old-message menu works;
- editing/branching old messages works after scrolling to them;
- switching conversations works;
- sidebar opening/closing does not corrupt heights;
- browser zoom works after geometry reset;
- reload works;
- extension disable works.

### 25.4 Context-safety sanity test

Use a disposable conversation containing a unique fact near the beginning.

After the old turn is optimized, ask ChatGPT to recall the fact.

This is not a formal guarantee about ChatGPT internals, but it is a useful regression check that presentation optimization has not accidentally interfered with normal conversation operation.

---

## 26. Implementation Phases

### Phase 0 — Skeleton

Deliver:

- MV3 manifest;
- content script;
- popup;
- settings storage;
- enable/disable;
- no virtualization yet.

### Phase 1 — DOM Adapter

Deliver:

- root detection;
- scroll-root detection;
- turn detection;
- SPA conversation switching;
- selector confidence/fail-safe logic;
- diagnostics.

No optimization until adapter tests pass.

### Phase 2 — Balanced Mode

Deliver:

- `content-visibility: auto`;
- intrinsic-size fallback;
- `ResizeObserver`;
- cleanup;
- protected live tail.

This should be the first usable release.

### Phase 3 — Geometry Controller

Deliver:

- viewport-distance calculation;
- IntersectionObserver;
- restore/park hysteresis;
- no Strong Mode activation yet;
- debug visualization optional.

### Phase 4 — Strong Mode

Deliver:

- measured intrinsic heights;
- `content-visibility: hidden` parking;
- focus/selection/hot-turn protection;
- search/print restoration;
- width-change invalidation;
- robust cleanup.

Keep experimental flag.

### Phase 5 — Benchmark & Hardening

Deliver:

- synthetic E2E fixture;
- benchmark notes;
- real ChatGPT smoke test;
- selector-change handling;
- README installation instructions.

---

## 27. Definition of Done

v1 is complete only when all of the following are true:

### Safety

- [ ] No ChatGPT-owned message element or child subtree is deleted/detached.
- [ ] No React internals are accessed.
- [ ] No ChatGPT network request is intercepted or modified.
- [ ] No conversation text is persisted.
- [ ] No telemetry is included.
- [ ] Extension uses minimal site/Chrome permissions.

### Behavior

- [ ] Long conversations remain scrollable.
- [ ] Scrolling upward reveals historical messages normally.
- [ ] Very tall messages overlapping the active region remain rendered.
- [ ] Current streaming output is never parked.
- [ ] Conversation switching works without reload.
- [ ] Browser resize/sidebar width changes do not leave wrong placeholder heights.
- [ ] Disabling restores normal page rendering.

### Compatibility

- [ ] Balanced Mode is default.
- [ ] Strong Mode is explicitly experimental.
- [ ] Find/print safeguards exist for Strong Mode.
- [ ] Selector failure results in no-op, not aggressive fallback.
- [ ] No known console errors during normal usage.

### Testing

- [ ] Unit tests for adapter/state/distance logic.
- [ ] Synthetic long-chat E2E test.
- [ ] Manual disposable ChatGPT long-chat test.
- [ ] Cleanup/disable test.
- [ ] SPA navigation test.

---

## 28. Codex Implementation Instructions

Use this document as the implementation contract.

### Priority order

1. Correctness and non-interference with ChatGPT.
2. Reliable restore-on-scroll behavior.
3. Stable scroll geometry.
4. Performance improvement.
5. UI polish.

### Hard constraints

Do not "improve" the design by:

- removing old DOM messages;
- cloning/replacing React nodes;
- patching ChatGPT JS;
- intercepting network calls;
- reading React fiber;
- reading/storing message text for optimization;
- adding broad extension permissions;
- adding telemetry.

If a stronger optimization appears to require one of those techniques, stop at the safe implementation and document the limitation.

### Preferred coding style

- small modules;
- explicit types;
- no global monkey patches;
- observer cleanup in one controller;
- DOM reads and writes batched separately;
- defensive guards around all site-specific selectors;
- comments explaining why a safety constraint exists;
- constants centralized in one config object;
- no magic class-name dependencies spread across files.

### Suggested controller API

```ts
interface OptimizerController {
  start(): Promise<void>;
  stop(): void;
  restoreAll(): void;
  updateSettings(settings: Settings): void;
  getDiagnostics(): Diagnostics;
}
```

### Suggested configuration

```ts
const DEFAULTS = {
  enabled: true,
  mode: "balanced",
  restoreBufferScreens: 3,
  parkBufferScreens: 5,
  protectedTailTurns: 2,
  hotMutationMs: 3000,
  initialIntrinsicHeightPx: 600
} as const;
```

---

## 29. Future v2 Ideas — Not Part of Initial Implementation

Only consider these after measuring v1.

### Possible

- adaptive buffer based on scroll velocity;
- temporary larger prefetch buffer during fast upward scrolling;
- per-turn render-cost estimate;
- user-visible performance benchmark;
- automatic mode fallback if a ChatGPT UI change is detected;
- support for other LLM chat websites through separate DOM adapters.

### High risk / requires separate design review

- detaching historical DOM subtrees;
- child/block-level virtualization inside a single assistant message;
- virtualizing code blocks or tables independently;
- interacting with ChatGPT's application state.

Do not implement high-risk items opportunistically.

---

## 30. Key Technical Rationale

### Why `content-visibility: auto` first?

It allows the browser to skip rendering work for off-screen content while leaving the DOM intact and is substantially safer than deleting/reactively reconstructing ChatGPT-owned elements.

### Why maintain a restore buffer?

Restoring only after an element becomes visible can create blank flashes or jank. A multi-screen buffer restores content in advance.

### Why hysteresis?

Without separate restore/park thresholds, messages near the boundary can rapidly alternate states while the user scrolls slightly.

### Why protect the newest turns?

They are the area most likely to be streaming or receiving dynamic UI updates.

### Why not use message count?

Turn height is highly variable. Pixel distance corresponds to actual rendering relevance.

### Why no block-level virtualization?

ChatGPT responses contain complex interactive components. Treating the whole turn as the optimization unit preserves ownership and reduces compatibility risk.

---

## 31. References

Implementation should verify behavior against the current browser documentation at development time:

- Chrome Extensions — Content scripts  
  `https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts`

- Chrome Extensions — Storage API  
  `https://developer.chrome.com/docs/extensions/reference/api/storage`

- MDN — `content-visibility`  
  `https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility`

These references describe the browser mechanisms only. They do not document ChatGPT's private frontend architecture, which must be treated as changeable implementation detail.

---

## 32. Final Handover Note

The extension should be thought of as a **rendering scheduler around an existing page**, not as a conversation manager.

The safest mental model is:

```text
ChatGPT owns:
- conversation
- DOM structure
- React state
- streaming
- interactions
- backend communication

Extension owns only:
- observation
- viewport-distance calculation
- extension-specific CSS rendering hints
- local preferences
```

If implementation choices preserve that boundary, the extension can provide useful long-chat performance improvements while minimizing the risk of interfering with ChatGPT behavior.
