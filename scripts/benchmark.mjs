import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const fixture = await readFile("tests/fixtures/long-chat.html", "utf8");
const bundle = await build({
  stdin: {
    contents:
      "import {OptimizerController} from './src/content/controller';import {DEFAULTS} from './src/content/settings';window.createOptimizer=(mode)=>{window.optimizer=new OptimizerController({...DEFAULTS,mode});window.optimizer.start();};",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (let trial = 1; trial <= 2; trial++)
    for (const mode of ["disabled", "balanced", "strong"]) {
      const page = await browser.newPage({
        viewport: { width: 1100, height: 800 },
      });
      await page.setContent(fixture);
      await page.addStyleTag({ path: "src/content/styles.css" });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      if (mode !== "disabled")
        await page.evaluate((mode) => window.createOptimizer(mode), mode);
      await page.waitForTimeout(3400);
      await page.evaluate(() => {
        const s = document.getElementById("scroller");
        s.scrollTop = s.scrollHeight - 20000;
      });
      await page.waitForTimeout(300);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("Tracing.start", {
        categories: "devtools.timeline",
        transferMode: "ReturnAsStream",
      });
      const before = Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
          m.name,
          m.value,
        ]),
      );
      const observations = await page.evaluate(async () => {
        const tasks = [];
        const observer = new PerformanceObserver((list) =>
          tasks.push(...list.getEntries().map((e) => e.duration)),
        );
        observer.observe({ type: "longtask" });
        const frames = [],
          batches = [];
        let prior = performance.now();
        const s = document.getElementById("scroller");
        for (let i = 0; i < 120; i++)
          await new Promise((resolve) =>
            requestAnimationFrame(() => {
              const now = performance.now();
              frames.push(now - prior);
              prior = now;
              s.scrollTop -= 160;
              // Deterministic ongoing tail changes, without any network or application state.
              if (i % 5 === 0) {
                const span = document.createElement("span");
                span.textContent = " Synthetic streaming output.";
                document.querySelector("article:last-child > div").append(span);
              }
              if (window.optimizer)
                batches.push(window.optimizer.getDiagnostics().lastBatchMs);
              resolve();
            }),
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
        observer.disconnect();
        frames.sort((a, b) => a - b);
        return {
          maxPageLongTaskMs: Math.max(0, ...tasks),
          longTasks: tasks.length,
          p95FrameMs: frames[Math.floor(frames.length * 0.95)],
          maxObservedExtensionBatchMs: Math.max(0, ...batches),
          descendantNodes: document.querySelector("main").querySelectorAll("*")
            .length,
          diagnostics: window.optimizer?.getDiagnostics(),
        };
      });
      const after = Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
          m.name,
          m.value,
        ]),
      );
      const complete = new Promise((resolve) =>
        cdp.once("Tracing.tracingComplete", resolve),
      );
      await cdp.send("Tracing.end");
      const { stream } = await complete;
      let trace = "";
      for (;;) {
        const chunk = await cdp.send("IO.read", { handle: stream });
        trace += chunk.data;
        if (chunk.eof) break;
      }
      await cdp.send("IO.close", { handle: stream });
      const paintUs = JSON.parse(trace)
        .traceEvents.filter((e) => e.name === "Paint" && e.ph === "X")
        .reduce((sum, e) => sum + (e.dur || 0), 0);
      const metrics = {};
      for (const name of [
        "LayoutDuration",
        "RecalcStyleDuration",
        "TaskDuration",
        "ScriptDuration",
      ])
        metrics[name + "Ms"] = (after[name] - before[name]) * 1000;
      results.push({
        trial,
        mode,
        ...metrics,
        paintMs: paintUs / 1000,
        ...observations,
      });
      console.log(JSON.stringify(results.at(-1)));
      await page.close();
    }
  await writeFile(
    "docs/benchmark-results.json",
    JSON.stringify(
      {
        browser: browser.version(),
        generatedAt: new Date().toISOString(),
        fixture:
          "400 turns; deterministic mixed content; 120 frames of upward scrolling with 24 streaming updates",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
