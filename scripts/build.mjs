import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: { content: "src/content/index.ts", popup: "src/popup/popup.ts" },
  outdir: "dist",
  bundle: true,
  target: "chrome120",
  format: "iife",
});
for (const [from, to] of [
  ["manifest.json", "manifest.json"],
  ["src/content/styles.css", "content.css"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
])
  await copyFile(from, `dist/${to}`);
