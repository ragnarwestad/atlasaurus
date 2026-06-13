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

test("Map-options toggles persist across a reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#show-mountains");
  await page.check("#show-mountains");
  await page.check("#show-flags");
  await page.reload();
  await page.waitForSelector("#show-flags");
  await expect(page.locator("#show-mountains")).toBeChecked();
  await expect(page.locator("#show-flags")).toBeChecked();
  await expect(page.locator("#show-cities")).not.toBeChecked(); // untouched stays off
  // Clean up so the persisted state doesn't leak into other tests.
  await page.uncheck("#show-mountains");
  await page.uncheck("#show-flags");
});
