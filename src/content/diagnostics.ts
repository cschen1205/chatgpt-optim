export interface Diagnostics {
  rootFound: boolean;
  managed: number;
  near: number;
  parked: number;
  cachedHeights: number;
  observerEvents: number;
  reason: string;
  lastBatchMs: number;
}
export const emptyDiagnostics = (): Diagnostics => ({
  rootFound: false,
  managed: 0,
  near: 0,
  parked: 0,
  cachedHeights: 0,
  observerEvents: 0,
  reason: "Waiting for a supported conversation",
  lastBatchMs: 0,
});
