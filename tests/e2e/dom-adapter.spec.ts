import { test, expect } from "@playwright/test";
import { build } from "esbuild";
let script: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents:
        "import {ChatGPTDomAdapter} from './src/content/dom-adapter'; window.adapter = new ChatGPTDomAdapter();",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
  });
  script = result.outputFiles[0].text;
});
test("adapter recognizes whole turns, ignores composer and nested role signals", async ({
  page,
}) => {
  await page.setContent(
    '<main><article data-testid="conversation-turn-1"><div data-message-author-role="user">A</div></article><article><div data-message-author-role="assistant">B</div></article><form><article data-testid="conversation-turn-2"><div data-message-author-role="user">C</div></article><textarea></textarea></form></main>',
  );
  await page.addScriptTag({ content: script });
  expect(
    await page.evaluate(() => {
      const a = (window as any).adapter;
      return a.findTurns(a.findConversationRoot()).length;
    }),
  ).toBe(2);
});
test("adapter fails closed on missing evidence, multiple roots, and multi-turn wrappers", async ({
  page,
}) => {
  for (const html of [
    "<main><article>Generic article</article></main>",
    '<main><article data-testid="conversation-turn-1"><div data-message-author-role="user">A</div><div data-message-author-role="assistant">B</div></article></main>',
    '<main><article><div data-message-author-role="user">A</div></article></main><main><article><div data-message-author-role="assistant">B</div></article></main>',
  ]) {
    await page.setContent(html);
    await page.addScriptTag({ content: script });
    expect(
      await page.evaluate(
        () => (window as any).adapter.findConversationRoot() === null,
      ),
    ).toBe(true);
  }
});
test("adapter detects an inner scroll container", async ({ page }) => {
  await page.setContent(
    '<main><div id="scroll" style="height:100px;overflow-y:auto"><article><div data-message-author-role="user" style="height:500px">A</div></article></div></main>',
  );
  await page.addScriptTag({ content: script });
  expect(
    await page.evaluate(() => {
      const a = (window as any).adapter;
      return a.findScrollRoot(a.findConversationRoot()).id;
    }),
  ).toBe("scroll");
});
test("nested semantic articles do not duplicate a logical turn", async ({
  page,
}) => {
  await page.setContent(
    '<main><article><article><div data-message-author-role="assistant">A</div></article></article></main>',
  );
  await page.addScriptTag({ content: script });
  expect(
    await page.evaluate(() => {
      const a = (window as any).adapter;
      return a.findTurns(a.findConversationRoot()).length;
    }),
  ).toBe(1);
});
