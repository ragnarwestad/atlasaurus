import { expect, test } from "@playwright/test";

// Offline-safe smoke checks: the shell renders and the help modal toggles.
// No CDN data is needed for any of this.

test("app loads with brand, sidebar and map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#brand")).toContainText("Atlasaurus");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#map")).toBeVisible();
});

test("the ⋮ menu's About opens and closes the help modal", async ({ page }) => {
  await page.goto("/");
  await page.click("#app-menu-btn");
  await page.click('.app-menu-item[data-menu="about"]');
  await expect(page.locator("#help-modal")).toBeVisible();
  await page.click(".help-close");
  await expect(page.locator("#help-modal")).toBeHidden();
});

test("the ⋮ menu opens Score, listing records with a reset", async ({ page }) => {
  await page.goto("/");
  await page.click("#app-menu-btn");
  await expect(page.locator("#app-menu")).toBeVisible();
  await page.click('.app-menu-item[data-menu="score"]');
  await expect(page.locator("#score-modal")).toBeVisible();
  await expect(page.locator("#score-list")).toContainText("No quizzes played yet."); // empty state
  await page.click(".score-close");
  await expect(page.locator("#score-modal")).toBeHidden();
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
