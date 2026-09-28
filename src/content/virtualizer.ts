import type { TurnMode } from "./turn-registry";
export interface Geometry {
  top: number;
  bottom: number;
}
export function viewportDistance(turn: Geometry, viewport: Geometry): number {
  return Math.max(viewport.top - turn.bottom, turn.top - viewport.bottom, 0);
}
export interface Policy {
  enabled: boolean;
  strong: boolean;
  distance: number;
  restore: number;
  park: number;
  protected: boolean;
  focused: boolean;
  selected: boolean;
  hot: boolean;
  height: number;
  suspended: boolean;
}
export function nextMode(current: TurnMode, p: Policy): TurnMode {
  if (
    !p.enabled ||
    p.protected ||
    p.focused ||
    p.selected ||
    p.hot ||
    p.suspended
  )
    return "normal";
  if (
    !p.strong ||
    p.distance <= p.restore ||
    !Number.isFinite(p.height) ||
    p.height <= 0
  )
    return "auto";
  if (p.distance >= p.park) return "parked";
  return current === "parked" ? "parked" : "auto";
}
export function scrollViewport(scroller: HTMLElement): Geometry {
  if (scroller === document.scrollingElement)
    return { top: 0, bottom: document.documentElement.clientHeight };
  const rect = scroller.getBoundingClientRect();
  const top = Math.max(0, rect.top + scroller.clientTop);
  return {
    top,
    bottom: Math.min(
      innerHeight,
      rect.top + scroller.clientTop + scroller.clientHeight,
    ),
  };
}
