import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, normalizeSettings } from "../src/content/settings";
test("balanced default and bounded hysteresis settings", () => {
  assert.deepEqual(normalizeSettings(), DEFAULTS);
  assert.equal(
    normalizeSettings({ restoreBufferScreens: 10, parkBufferScreens: 2 })
      .parkBufferScreens,
    12,
  );
  assert.equal(
    normalizeSettings({ restoreBufferScreens: NaN }).restoreBufferScreens,
    3,
  );
});
