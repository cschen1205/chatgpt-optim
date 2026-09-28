import { test, expect } from "@playwright/test";
import { boot, diagnostics } from "./helpers";
test("Strong parks far turns, restores ahead of visibility, keeps huge overlap and scroll anchor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page, "strong");
  expect((await diagnostics(page)).parked).toBeGreaterThan(300);
  const before = await page.locator("main *").count();
  await page.evaluate(() => {
    const s = document.getElementById("scroller")!;
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const a = document.querySelectorAll("article")[100];
    const scroller = document.getElementById("scroller")!;
    scroller.scrollTop += a.getBoundingClientRect().top - 2000;
  });
  await expect(page.locator("article").nth(100)).not.toHaveClass(
    /lcopt-parked/,
  );
  const top = await page.evaluate(
    () => document.querySelectorAll("article")[100].getBoundingClientRect().top,
  );
  await page.waitForTimeout(200);
  expect(
    Math.abs(
      (await page.evaluate(
        () =>
          document.querySelectorAll("article")[100].getBoundingClientRect().top,
      )) - top,
    ),
  ).toBeLessThanOrEqual(10);
  await page.evaluate(() => {
    const huge = document.getElementById("huge")!;
    document.getElementById("scroller")!.scrollTop +=
      huge.getBoundingClientRect().top + 10000;
  });
  await expect(page.locator("article").nth(180)).not.toHaveClass(
    /lcopt-parked/,
  );
  expect(await page.locator("main *").count()).toBe(before);
  expect(errors).toEqual([]);
});
test("search and print restore immediately without preventing shortcuts", async ({
  page,
}) => {
  await boot(page, "strong");
  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await page.locator(".lcopt-parked").count()).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  expect(await page.locator("[data-lcopt-managed]").count()).toBe(0);
  await page.waitForTimeout(150);
  expect(await page.locator("[data-lcopt-managed]").count()).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});
test("width reset remeasures, focus selection and mutations protect turns", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.evaluate(() => {
    document.querySelector("main")!.style.maxWidth = "600px";
  });
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).managed).toBe(400);
  await page.evaluate(() => {
    document.getElementById("scroller")!.scrollTop += document
      .querySelectorAll("article")[70]
      .getBoundingClientRect().top;
  });
  await expect(page.locator("article").nth(70)).not.toHaveClass(/lcopt-parked/);
  await page.evaluate(() => {
    document
      .querySelectorAll("article")[70]
      .querySelector("button")!
      .focus({ preventScroll: true });
    document.getElementById("scroller")!.scrollTop = 0;
  });
  await expect(page.locator("article").nth(70)).not.toHaveClass(/lcopt-parked/);
  await page.evaluate(() => {
    const a = document.querySelectorAll("article")[80];
    a.querySelector("p span")!.firstChild!.nodeValue = "Stream update";
  });
  await expect(page.locator("article").nth(80)).not.toHaveClass(/lcopt-parked/);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll("article")[81]);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(page.locator(".lcopt-parked")).toHaveCount(0);
  await page.evaluate(() => (window as any).optimizer.stop());
  expect(await page.locator("[data-lcopt-managed]").count()).toBe(0);
});

test("intrinsic content-box heights remain accurate after width invalidation", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.evaluate(
    () => (document.querySelector("main")!.style.maxWidth = "420px"),
  );
  await page.waitForTimeout(250);
  const differences = await page.evaluate(() => {
    const samples = [
      ...document.querySelectorAll<HTMLElement>(".lcopt-parked"),
    ].filter((_, i) => i % 40 === 0);
    const before = samples.map((el) => el.getBoundingClientRect().height);
    (window as any).optimizer.stop();
    return samples.map((el, i) =>
      Math.abs(el.getBoundingClientRect().height - before[i]),
    );
  });
  expect(differences.length).toBeGreaterThan(5);
  expect(Math.max(...differences)).toBeLessThanOrEqual(1);
});

test("column width change inside unchanged root invalidates parked heights", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.addStyleTag({
    content: "article{width:400px;box-sizing:border-box}",
  });
  await page.waitForTimeout(250);
  const delta = await page.evaluate(() => {
    const a = document.querySelector<HTMLElement>(".lcopt-parked")!;
    const height = a.getBoundingClientRect().height;
    (window as any).optimizer.stop();
    return Math.abs(a.getBoundingClientRect().height - height);
  });
  expect(delta).toBeLessThanOrEqual(1);
});
