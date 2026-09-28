export interface Settings {
  enabled: boolean;
  mode: "balanced" | "strong";
  restoreBufferScreens: number;
  parkBufferScreens: number;
  debug: boolean;
}
export const DEFAULTS: Settings = {
  enabled: true,
  mode: "balanced",
  restoreBufferScreens: 3,
  parkBufferScreens: 5,
  debug: false,
};
export const CONFIG = {
  protectedTailTurns: 2,
  hotMutationMs: 3000,
  initialIntrinsicHeightPx: 600,
  resumeMs: 30000,
  widthTolerance: 2,
} as const;
export function normalizeSettings(value: unknown = {}): Settings {
  const raw = (
    value && typeof value === "object" ? value : {}
  ) as Partial<Settings>;
  const restore = Number.isFinite(raw.restoreBufferScreens)
    ? Math.min(10, Math.max(1, Number(raw.restoreBufferScreens)))
    : 3;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    mode: raw.mode === "strong" ? "strong" : "balanced",
    restoreBufferScreens: restore,
    parkBufferScreens: Math.max(
      restore + 2,
      Number.isFinite(raw.parkBufferScreens)
        ? Math.min(20, Number(raw.parkBufferScreens))
        : 5,
    ),
    debug: raw.debug === true,
  };
}
export async function readSettings(): Promise<Settings> {
  return normalizeSettings(
    (await chrome.storage.local.get("settings")).settings,
  );
}
