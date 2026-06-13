import { expect, test } from "@playwright/test";

// Offline-safe smoke checks: the shell renders and the help modal toggles.
// No CDN data is needed for any of this.

test("app loads with brand, sidebar and map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#brand")).toContainText("Atlasaurus");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
});

test("the ? button opens and closes the help modal", async ({ page }) => {
  await page.goto("/");
  await page.click("#brand .help-btn");
  await expect(page.locator("#help-modal")).toBeVisible();
  await page.click(".help-close");
  await expect(page.locator("#help-modal")).toBeHidden();
});
