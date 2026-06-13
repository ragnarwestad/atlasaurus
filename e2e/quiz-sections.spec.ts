import { expect, test } from "@playwright/test";

// Covers the Quiz panel's collapsible section layout (mirrors the Explore list):
// six feature sections top to bottom, accordion behaviour, and the disabled
// "coming soon" placeholders. Offline-safe — asserts only on static UI, never on
// data-dependent counts.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#mode-tabs .mode-tab");
  await page.click('.mode-tab[data-mode="quiz"]');
  await expect(page.locator("#quiz-panel")).toBeVisible();
});

test("Quiz shows six feature sections top to bottom", async ({ page }) => {
  const sections = page.locator("#quiz-panel .quiz-sec");
  await expect(sections).toHaveCount(6);
  await expect(sections.locator(".sb-title")).toHaveText([
    "Countries", "Cities soon", "Regions", "Lakes soon", "Mountains", "Rivers soon",
  ]);
});

test("Countries opens by default with its mode row", async ({ page }) => {
  await expect(page.locator("#quiz-sec-countries")).not.toHaveClass(/collapsed/);
  // The shared question UI is relocated into the open section's body.
  await expect(page.locator("#quiz-sec-countries #quiz-ui")).toBeVisible();
  await expect(page.locator("#quiz-sec-countries #quiz-type")).toBeVisible();
  await expect(page.locator('#quiz-type .qt-btn[data-qtype="name"]')).toHaveClass(/active/);
});

test("opening another section is accordion: the previous one collapses", async ({ page }) => {
  await page.click('[data-quiz-sec="mountains"]');
  await expect(page.locator("#quiz-sec-mountains")).not.toHaveClass(/collapsed/);
  await expect(page.locator("#quiz-sec-countries")).toHaveClass(/collapsed/);
  // The shared UI followed into Mountains, alongside its own mode row.
  await expect(page.locator("#quiz-sec-mountains #quiz-ui")).toBeVisible();
  await expect(page.locator("#quiz-sec-mountains #mtn-type")).toBeVisible();
});

test("clicking the open section's header collapses it", async ({ page }) => {
  await page.click('[data-quiz-sec="countries"]');
  await expect(page.locator("#quiz-sec-countries")).toHaveClass(/collapsed/);
});

test("Regions opens and runs (no sub-mode row)", async ({ page }) => {
  await page.click('[data-quiz-sec="regions"]');
  await expect(page.locator("#quiz-sec-regions")).not.toHaveClass(/collapsed/);
  await expect(page.locator("#quiz-sec-regions #quiz-ui")).toBeVisible();
  await expect(page.locator("#quiz-sec-regions #quiz-type")).toHaveCount(0);
});

test("Cities/Lakes/Rivers are disabled placeholders that stay collapsed", async ({ page }) => {
  for (const id of ["cities", "lakes", "rivers"]) {
    const sec = page.locator(`#quiz-sec-${id}`);
    await expect(sec).toHaveClass(/disabled/);
    await page.locator(`[data-quiz-sec="${id}"]`).click({ force: true });
    await expect(sec).toHaveClass(/collapsed/);
  }
  // Countries stays the active one — the disabled clicks did nothing.
  await expect(page.locator("#quiz-sec-countries")).not.toHaveClass(/collapsed/);
});
