# ChatGPT Long Chat Optimizer

A dependency-free-at-runtime Manifest V3 extension that adds rendering hints to whole conversation turns. It does not change conversation context, remove message DOM, or reduce raw DOM-node count.

## Install

Requires Node.js 22+ and desktop Chrome/Chromium 120+.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `dist/` directory. Reload existing ChatGPT tabs after installation or updating the unpacked extension. It runs only on `https://chatgpt.com/*` and `https://chat.openai.com/*`.

Open the toolbar popup to change settings. **Balanced — Recommended** is enabled by default. **Strong — Experimental** must be explicitly selected. Settings apply to open supported tabs through `chrome.storage.local`.

**Restore all now** restores normal rendering for 30 seconds. Uncheck **Enable optimization** and save to remove all owned hints and stop the controller without reloading. Disabling/uninstalling the extension in Chrome itself may require reloading existing tabs; Chrome does not deliver a content-script teardown callback.

## Architecture

- `src/content/dom-adapter.ts`: all site selectors; validates whole turns, excludes composer and ambiguous/nested structures, discovers scroll container. Requires exactly one user/assistant role marker within a turn test-id wrapper or semantic article. Unsupported markup is inactive.
- `turn-registry.ts`: WeakMap lookup plus ordered connected records; geometry and timestamps only.
- `controller.ts`: MutationObserver discovery, scoped text-mutation protection, ResizeObserver measurement, IntersectionObserver prefetch signals, SPA lifecycle, focus/selection/search/print safeguards and centralized cleanup.
- `virtualizer.ts`: pure pixel-distance and state policy. Restore within 3 viewport heights, park beyond 5, retain state between thresholds. The latest two turns are a safety exception only. A huge turn crossing the viewport always stays rendered.
- `style-controller.ts` / `styles.css`: only `lcopt-auto`, `lcopt-parked`, `--lcopt-height`, and `data-lcopt-managed`. Existing conflicting hints are skipped. Content-box measurements account for padding and borders.
- `scheduler.ts`: one animation-frame geometry batch and bounded idle discovery with a timeout fallback. Streaming updates mark known turns hot for 3 seconds without whole-page rescans. New subtrees are discovered incrementally. A 2-second lifecycle check detects URL/scroller changes without patching history.
- `settings.ts`, `diagnostics.ts`, and `src/popup/`: normalized preferences, numeric diagnostics, plain HTML popup, messaging. No service worker or UI framework.

Balanced uses `content-visibility: auto`; Strong can use `hidden` only with valid measured heights and no protection condition. Protected, hot, focused, selected, and temporarily restored turns use normal rendering. Width changes restore all, invalidate caches, and measure before resuming.

## Privacy and constraints

Only `storage` permission is requested. There are no host permissions beyond the two static content-script matches, no telemetry, remote code, network calls/interception, React internals, clipboard/cookie/auth reads, or conversation-text persistence. Only normalized user preferences are stored. Popup diagnostics are numeric counters and fixed status labels, not conversation data. No message text is read by the optimizer. Production code never removes, moves, clones, replaces, or rewrites a page-owned subtree.

Browser references checked during implementation: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [MDN content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility).

## Verification

```sh
npx playwright install chromium
npm test
npm run format:check
npm run benchmark
```

The synthetic tests default to system Google Chrome at `/usr/bin/google-chrome`; override `CHROME_PATH` if needed. Packaged-extension tests use Playwright's installed Chromium; override `EXTENSION_CHROME_PATH` if needed. No login or external conversation is used: test-only routing supplies the fixture under a manifest-matched origin. Test mocks and fixture builders are never shipped in `dist/`.

Tests cover adapter ambiguity, geometry/hysteresis, protections, whole-DOM preservation, upward restoration, 20,000px content, width reset, search/print, enable/disable, SPA replacement, streaming, conflicting hints, observer failure, actual MV3 popup/storage/content-script integration, and static source/manifest safety guards.

See [benchmark notes](docs/benchmark.md), [implementation report](docs/implementation-report.md), and the [manual release checklist](docs/manual-testing.md).

## Limits

- ChatGPT's private authenticated DOM was not available for inspection in this environment. Selectors are conservative candidate signals, validated on synthetic markup. Actual ChatGPT smoke testing remains a release gate; the extension may intentionally be inactive on an unsupported layout.
- Strong's parked descendants cannot normally be searched, focused, selected, or exposed to accessibility tools. Ctrl/Cmd+F and Ctrl/Cmd+P restore before the default action; `beforeprint` restores until printing ends. Browser-menu search has no reliable page event, and search may last beyond the 30-second pause. Prefer Balanced or disable optimization during extended search/accessibility use.
- An entire huge message stays active. This intentionally limits the gain while inside one complex response.
- Initial discovery/measurement and width invalidation can be expensive on extreme pages. Steady-scroll benchmark results are not startup-time guarantees or real ChatGPT performance claims.
- Geometry changes caused by the site itself, browser anchoring choices, or future frontend markup can still affect scrolling. No application state or network behavior is altered to compensate.
