import { test, expect } from "@playwright/test";
import { boot, diagnostics } from "./helpers";
test("incremental arrival, streaming mutation, selector loss and disabled observers", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.evaluate(() => {
    const turn = document.createElement("article");
    turn.dataset.testid = "conversation-turn-400";
    const role = document.createElement("div");
    role.dataset.messageAuthorRole = "assistant";
    role.textContent = "New streamed turn";
    turn.append(role);
    document.querySelector("main")!.append(turn);
  });
  await expect.poll(() => diagnostics(page).then((d) => d.managed)).toBe(401);
  await expect(page.locator("article").last()).not.toHaveClass(/lcopt-parked/);
  await page.evaluate(() => {
    for (const turn of document.querySelectorAll("article")) {
      turn.removeAttribute("data-testid");
      turn
        .querySelector("[data-message-author-role]")
        ?.removeAttribute("data-message-author-role");
    }
  });
  await expect(page.locator("[data-lcopt-managed]")).toHaveCount(0);
  expect((await diagnostics(page)).rootFound).toBe(false);
  await page.evaluate(() => (window as any).optimizer.stop());
  const before = await diagnostics(page);
  await page.evaluate(() =>
    document.querySelector("main")!.append(document.createElement("p")),
  );
  await page.waitForTimeout(250);
  expect(await diagnostics(page)).toEqual(before);
});
test("conflicting site styles are skipped and unchanged", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (window as any).optimizer.stop();
    const a = document.querySelector("article") as HTMLElement;
    a.style.contentVisibility = "auto";
    a.style.setProperty("--lcopt-height", "123px");
    a.setAttribute("data-lcopt-managed", "site-value");
  });
  await page.evaluate(() => (window as any).optimizer.start());
  await page.waitForTimeout(3200);
  expect((await diagnostics(page)).managed).toBe(399);
  await page.evaluate(() => (window as any).optimizer.stop());
  expect(
    await page.locator("article").first().getAttribute("data-lcopt-managed"),
  ).toBe("site-value");
  expect(await page.locator("article").first().getAttribute("style")).toContain(
    "--lcopt-height: 123px",
  );
});
test("observer callback failure restores and stops safely", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.evaluate(() => {
    (window as any).optimizer.adapter.findConversationRoot = () => {
      throw new Error("test failure");
    };
    document.querySelector("main")!.setAttribute("data-testid", "test-trigger");
  });
  await expect(page.locator("[data-lcopt-managed]")).toHaveCount(0);
  expect((await diagnostics(page)).reason).toContain("Stopped safely");
});

test("late role insertion and scroll-container replacement are discovered", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.evaluate(() => {
    const turn = document.createElement("article");
    turn.dataset.testid = "conversation-turn-400";
    turn.id = "late-turn";
    document.querySelector("main")!.append(turn);
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const role = document.createElement("div");
    role.dataset.messageAuthorRole = "assistant";
    role.textContent = "Late content";
    document.getElementById("late-turn")!.append(role);
  });
  await expect.poll(() => diagnostics(page).then((d) => d.managed)).toBe(401);
  await page.evaluate(() => {
    const s = document.getElementById("scroller")!;
    s.style.height = "auto";
    s.style.overflow = "visible";
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).optimizer.scroller === document.scrollingElement,
      ),
    )
    .toBe(true);
});
test("URL navigation without root replacement rebuilds safely", async ({
  page,
}) => {
  await page.route("http://fixture.test/**", (route) =>
    route.fulfill({
      body: "<!doctype html><body></body>",
      contentType: "text/html",
    }),
  );
  await page.goto("http://fixture.test/first");
  await boot(page, "strong");
  await page.evaluate(() => history.pushState({}, "", "/second"));
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).optimizer.url.endsWith("/second")),
    )
    .toBe(true);
  expect((await diagnostics(page)).managed).toBe(400);
});

test("fresh disabled controller reports disabled without adding hints", async ({
  page,
}) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const previous = (window as any).optimizer;
    previous.stop();
    const controller = new previous.constructor({
      ...previous.settings,
      enabled: false,
    });
    (window as any).optimizer = controller;
    await controller.start();
    return controller.getDiagnostics();
  });
  expect(result.reason).toBe("Disabled");
  expect(result.managed).toBe(0);
  await expect(page.locator("[data-lcopt-managed]")).toHaveCount(0);
});

test("restore diagnostics are immediate and pause status expires", async ({
  page,
}) => {
  await boot(page, "strong");
  await page.clock.install();
  const result = await page.evaluate(() => {
    const controller = (window as any).optimizer;
    const before = controller.getDiagnostics().parked;
    controller.restoreAll();
    return { before, after: controller.getDiagnostics() };
  });
  expect(result.before).toBeGreaterThan(0);
  expect(result.after.parked).toBe(0);
  expect(result.after.cachedHeights).toBe(0);
  expect(result.after.reason).toContain("paused");
  await page.clock.fastForward(30200);
  await expect
    .poll(() => diagnostics(page).then((d) => d.reason))
    .toBe("Active");
  await expect
    .poll(() => diagnostics(page).then((d) => d.parked))
    .toBeGreaterThan(0);
});
