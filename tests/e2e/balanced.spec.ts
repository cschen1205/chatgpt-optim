import { test, expect } from "@playwright/test";
import { boot, diagnostics } from "./helpers";
test("balanced preserves DOM, protects tail, cleans owned styles, reenables", async ({
  page,
}) => {
  await boot(page);
  expect((await diagnostics(page)).managed).toBe(400);
  expect(await page.locator(".lcopt-parked").count()).toBe(0);
  expect(
    (await page.locator("article").last().getAttribute("class")) || "",
  ).not.toContain("lcopt-auto");
  const count = await page.locator("main *").count();
  await page.evaluate(() => {
    const a = document.querySelector("article")!;
    a.classList.add("site-owned");
    (a as HTMLElement).style.color = "red";
    (window as any).optimizer.stop();
  });
  expect(
    await page
      .locator("[data-lcopt-managed],.lcopt-auto,.lcopt-parked")
      .count(),
  ).toBe(0);
  expect(await page.locator("main *").count()).toBe(count);
  expect(await page.locator("article").first().getAttribute("style")).toBe(
    "color: red;",
  );
  await page.evaluate(() => (window as any).optimizer.start());
  await expect(page.locator(".lcopt-auto").first()).toBeAttached();
});
test("SPA replacement releases old nodes and discovers new conversation", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const root = document.querySelector("main")!;
    (window as any).oldRoot = root;
    const next = root.cloneNode(true) as HTMLElement;
    for (const e of next.querySelectorAll<HTMLElement>("article")) {
      e.classList.remove("lcopt-auto", "lcopt-parked");
      e.removeAttribute("data-lcopt-managed");
      e.style.removeProperty("--lcopt-height");
    }
    root.replaceWith(next);
  });
  await expect.poll(() => diagnostics(page).then((d) => d.managed)).toBe(400);
  await page.waitForTimeout(1100);
  expect(
    await page.evaluate(
      () =>
        (window as any).oldRoot.querySelectorAll("[data-lcopt-managed]").length,
    ),
  ).toBe(0);
});
