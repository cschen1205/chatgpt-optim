import type { TurnRecord, TurnMode } from "./turn-registry";
import { CONFIG } from "./settings";
export function hasConflict(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return (
    el.classList.contains("lcopt-auto") ||
    el.classList.contains("lcopt-parked") ||
    el.hasAttribute("data-lcopt-managed") ||
    !!el.style.getPropertyValue("--lcopt-height") ||
    !!el.style.getPropertyValue("content-visibility") ||
    !!el.style.getPropertyValue("contain-intrinsic-size") ||
    style.contentVisibility !== "visible" ||
    !["none", "none none"].includes(style.containIntrinsicSize) ||
    style.writingMode !== "horizontal-tb"
  );
}
export function setMode(record: TurnRecord, mode: TurnMode) {
  const { el } = record;
  const height = `${record.lastMeasuredHeight || CONFIG.initialIntrinsicHeightPx}px`;
  if (
    record.mode === mode &&
    (mode === "normal" ||
      el.style.getPropertyValue("--lcopt-height") === height)
  )
    return;
  if (mode === "normal") {
    el.classList.remove("lcopt-auto", "lcopt-parked");
    el.style.removeProperty("--lcopt-height");
    el.removeAttribute("data-lcopt-managed");
  } else {
    el.style.setProperty(
      "--lcopt-height",
      `${record.lastMeasuredHeight || CONFIG.initialIntrinsicHeightPx}px`,
    );
    el.classList.toggle("lcopt-auto", mode === "auto");
    el.classList.toggle("lcopt-parked", mode === "parked");
    el.setAttribute("data-lcopt-managed", "");
  }
  record.mode = mode;
}
// Intrinsic block size describes the content box, not border-box DOMRect height.
export function measure(el: HTMLElement) {
  const rect = el.getBoundingClientRect(),
    style = getComputedStyle(el);
  return {
    width: Math.max(
      0,
      rect.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth),
    ),
    height: Math.max(
      0,
      rect.height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom) -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth),
    ),
  };
}
