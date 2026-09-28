import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHash } from "node:crypto";
test("packaged MV3 storage, popup and content-script integration", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lcopt-extension-"));
  const extension = join(temp, "extension");
  await cp("dist", extension, { recursive: true });
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ type: "spki", format: "der" });
  const id = createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  manifest.key = key.toString("base64");
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(
    join(temp, "profile"),
    {
      executablePath:
        process.env.EXTENSION_CHROME_PATH || chromium.executablePath(),
      headless: true,
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Test-only routing provides a synthetic page at the manifest origin. Production never intercepts requests.
    await context.route("https://chatgpt.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        path: "tests/fixtures/long-chat.html",
      }),
    );
    await page.goto("https://chatgpt.com/c/synthetic");
    await page.waitForSelector(".lcopt-auto");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.locator("#mode")).toHaveValue("balanced");
    await popup.locator("#mode").selectOption("strong");
    await popup.locator("button[type=submit]").click();
    await page.waitForSelector(".lcopt-parked");
    await popup.locator("#enabled").uncheck();
    await popup.locator("button[type=submit]").click();
    await expect(page.locator("[data-lcopt-managed]")).toHaveCount(0);
    const stored = await popup.evaluate(() => chrome.storage.local.get(null));
    expect(Object.keys(stored)).toEqual(["settings"]);
    expect(stored.settings).toEqual({
      enabled: false,
      mode: "strong",
      restoreBufferScreens: 3,
      parkBufferScreens: 5,
      debug: false,
    });
    await popup.locator("#enabled").check();
    await popup.locator("button[type=submit]").click();
    await page.waitForSelector(".lcopt-parked");
    await page.bringToFront();
    await popup.evaluate(() => document.getElementById("restore-all")!.click());
    await expect(page.locator("[data-lcopt-managed]")).toHaveCount(0);
    await expect(popup.locator("#status")).toContainText("Managed: 400");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(temp, { recursive: true, force: true });
  }
});
