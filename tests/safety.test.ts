import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
async function source(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? source(`${dir}/${e.name}`)
          : readFile(`${dir}/${e.name}`, "utf8"),
      ),
    )
  ).join("\n");
}
test("MV3 has only storage and exact supported origins", async () => {
  const m = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ["storage"]);
  assert.deepEqual(m.content_scripts[0].matches, [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
  ]);
  for (const field of [
    "background",
    "host_permissions",
    "web_accessible_resources",
    "externally_connectable",
  ])
    assert.equal(m[field], undefined);
});
test("production source guardrails: no subtree edits, application internals, requests or conversation reads", async () => {
  const s = await source("src");
  for (const forbidden of [
    /(?<!classList)\.remove\s*\(/,
    /\.(innerHTML|outerHTML)\s*=/,
    /\.(replaceChildren|replaceWith|removeChild|appendChild|insertBefore)\s*\(/,
    /DocumentFragment/,
    /(__react|reactFiber|reactInternal)/i,
    /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/,
    /document\.cookie/,
    /navigator\.(clipboard|sendBeacon)/,
    /\.(textContent|innerText)\b/,
    /localStorage|sessionStorage/,
  ])
    assert.ok(!forbidden.test(s), `Forbidden production pattern: ${forbidden}`);
});
