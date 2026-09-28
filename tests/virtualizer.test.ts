import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewportDistance,
  nextMode,
  type Policy,
} from "../src/content/virtualizer";
const policy: Policy = {
  enabled: true,
  strong: true,
  distance: 8000,
  restore: 3000,
  park: 5000,
  protected: false,
  focused: false,
  selected: false,
  hot: false,
  height: 800,
  suspended: false,
};
for (const [name, top, bottom, expected] of [
  ["visible", 50, 400, 0],
  ["one screen above", -1500, -1000, 1000],
  ["four screens above", -4500, -4000, 4000],
  ["eight screens above", -8500, -8000, 8000],
  ["eight screens below", 9000, 9500, 8000],
  ["huge overlap", -10000, 10000, 0],
  ["zero height", 2000, 2000, 1000],
] as const)
  test(name, () =>
    assert.equal(
      viewportDistance({ top, bottom }, { top: 0, bottom: 1000 }),
      expected,
    ),
  );
test("normal → auto → parked → auto → normal", () => {
  assert.equal(nextMode("normal", { ...policy, strong: false }), "auto");
  assert.equal(nextMode("auto", policy), "parked");
  assert.equal(nextMode("parked", { ...policy, distance: 1000 }), "auto");
  assert.equal(nextMode("parked", { ...policy, enabled: false }), "normal");
});
test("hysteresis retains state between thresholds", () => {
  assert.equal(nextMode("parked", { ...policy, distance: 4000 }), "parked");
  assert.equal(nextMode("auto", { ...policy, distance: 4000 }), "auto");
});
for (const protection of [
  "protected",
  "focused",
  "selected",
  "hot",
  "suspended",
] as const)
  test(protection, () =>
    assert.equal(
      nextMode("parked", { ...policy, [protection]: true }),
      "normal",
    ),
  );
for (const height of [0, NaN, -1])
  test(`invalid height ${height}`, () =>
    assert.equal(nextMode("auto", { ...policy, height }), "auto"));
