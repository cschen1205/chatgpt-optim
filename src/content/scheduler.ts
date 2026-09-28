export class Scheduler {
  private frame = 0;
  private idle = 0;
  private idleFallback = false;
  frameTask(fn: () => void) {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        fn();
      });
  }
  idleTask(fn: () => void) {
    if (this.idle) return;
    const run = () => {
      this.idle = 0;
      fn();
    };
    this.idleFallback = typeof requestIdleCallback !== "function";
    this.idle = this.idleFallback
      ? window.setTimeout(run, 100)
      : requestIdleCallback(run, { timeout: 1000 });
  }
  stop() {
    cancelAnimationFrame(this.frame);
    if (this.idleFallback) clearTimeout(this.idle);
    else if (typeof cancelIdleCallback === "function")
      cancelIdleCallback(this.idle);
    this.frame = this.idle = 0;
  }
}
