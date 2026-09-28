import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
export async function boot(page: Page, mode = "balanced") {
  await page.setContent(
    await readFile("tests/fixtures/long-chat.html", "utf8"),
  );
  await page.addStyleTag({ path: "src/content/styles.css" });
  const result = await build({
    stdin: {
      contents: `import {OptimizerController} from './src/content/controller';import {DEFAULTS} from './src/content/settings';window.optimizer=new OptimizerController({...DEFAULTS,mode:${JSON.stringify(mode)}});window.optimizer.start();`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
  });
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-lcopt-managed]").length > 0,
  );
}
export const diagnostics = (page: Page) =>
  page.evaluate(() => (window as any).optimizer.getDiagnostics());
