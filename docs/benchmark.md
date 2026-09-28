# Synthetic benchmark

Run `npm run benchmark` to reproduce. Raw numeric evidence is in [benchmark-results.json](benchmark-results.json).

## Method

- Browser: Chrome 146.0.7680.164, Linux, headless, 1100×800 viewport.
- Two independent trials per mode: disabled baseline, Balanced, Strong.
- Fixture: 400 turns, 74,831 descendant **elements** after 24 synthetic streaming additions (text nodes are not included in that count), deterministic paragraphs, code, tables, image placeholders, and a 20,000px block inside one whole turn.
- Let initialization settle for 3.4 seconds, position near the bottom, then scroll upward 160px per frame for 120 frames while appending synthetic tail output every fifth frame.
- Chrome DevTools Protocol performance counters measure layout, style, script and main-thread task durations. Timeline trace `Paint` slices measure recorded paint CPU duration; they are not GPU raster time. The page Long Tasks API records tasks ≥50ms. Extension batch timings are sampled from diagnostics each frame and are not a complete profiler trace of every extension callback.
- Results below are means in milliseconds across two trials. Browser tracing/harness overhead is included consistently in all modes. Startup discovery and full width-reset work are outside this steady-scroll interval.

| Mode | Layout ms | Style ms | Paint ms | Script ms | Main-thread task ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Disabled | 53.59 | 0.67 | 57.45 | 45.54 | 289.64 |
| Balanced | 40.98 | 3.47 | 14.96 | 129.04 | 293.75 |
| Strong | 49.03 | 3.91 | 13.93 | 131.09 | 296.10 |

Balanced reduced layout time by about 24% and recorded paint time by about 74% on this fixture. Strong reduced paint similarly but did not outperform Balanced on layout. Script/style overhead increased, and total main-thread task time increased slightly; **this benchmark does not establish an overall CPU or frame-rate improvement**. Both modes retained a 16.8ms p95 frame interval, as did the already-smooth baseline.

No ≥50ms page long task was observed during the measured scrolling intervals. The largest sampled extension batch was 2.1ms, below the suggested 100ms ceiling. The browser tests separately check a sampled restored turn for ≤10px persistent movement and parked content-box heights after width reset for ≤1px difference from restored layout. These are bounded synthetic checks, not a guarantee for every page or machine.

All modes retained the same descendant element count. Strong parked 392 turns at the final measurement; the decision remained geometry-based with a protected live tail. No memory-reduction claim is made.

## Interpretation and release limits

These results demonstrate reduced rendering/layout work in the requested synthetic workload, with measurable controller overhead. Favor Balanced by default. Large messages, startup measurement, layout resets, hardware differences, Chrome revisions, and actual ChatGPT markup can materially change the benefit. No hard percentage target is used as a release gate.

Authenticated ChatGPT performance and compatibility remain unmeasured. Follow [the manual checklist](manual-testing.md) before calling the handover's complete Definition of Done satisfied. No real conversation data was used or recorded by this benchmark.
