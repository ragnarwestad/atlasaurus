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
    "Countries", "Cities", "Regions", "Lakes", "Mountains", "Rivers",
  ]);
});

test("Cities opens with its Name it / Which country mode row", async ({ page }) => {
  await page.click('[data-quiz-sec="cities"]');
  await expect(page.locator("#quiz-sec-cities")).not.toHaveClass(/collapsed/);
  await expect(page.locator("#quiz-sec-countries")).toHaveClass(/collapsed/);
  await expect(page.locator("#quiz-sec-cities #quiz-ui")).toBeVisible();
  await expect(page.locator("#city-type .qt-btn")).toHaveText(["Name it", "Which country"]);
  await expect(page.locator('#city-type .qt-btn[data-qtype="cityname"]')).toHaveClass(/active/);
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

test("Mountains 'Name it' answers via a name search box, not choice buttons", async ({ page }) => {
  await page.click('[data-quiz-sec="mountains"]');
  await expect(page.locator("#quiz-sec-mountains #name-box")).toBeVisible();
  await expect(page.locator("#quiz-sec-mountains #quiz-choices")).toBeHidden();
  // PEAKS is bundled (no CDN), so the name search works offline.
  await page.fill("#name-input", "ever");
  await expect(page.locator("#name-results li").first()).toBeVisible();
});

test("Mountains 'Which country' has search + map-click both live, no mode toggle", async ({ page }) => {
  await page.click('[data-quiz-sec="mountains"]');
  await page.click('#mtn-type .qt-btn[data-qtype="peakcountry"]');
  await expect(page.locator("#quiz-sec-mountains #loc-box")).toBeVisible();
  await expect(page.locator("#quiz-sec-mountains #loc-input")).toBeVisible(); // country search always available
  await expect(page.locator("#quiz-sec-mountains #loc-mode")).toBeHidden();   // no Click-on-map / Select toggle
  await expect(page.locator("#quiz-sec-mountains #name-box")).toBeHidden();
});

test("score shows the active category and the reset button clears it", async ({ page }) => {
  await page.click('[data-quiz-sec="mountains"]');
  await page.fill("#name-input", "ever"); // PEAKS is bundled — works offline
  await page.locator("#name-results li").first().click(); // answer (right or wrong)
  await expect(page.locator("#quiz-score")).toHaveText(/^Mountains: \d \/ 1$/);
  await page.click("#quiz-reset");
  await expect(page.locator("#quiz-score")).toHaveText("");
});

test("Regions opens and runs (no sub-mode row)", async ({ page }) => {
  await page.click('[data-quiz-sec="regions"]');
  await expect(page.locator("#quiz-sec-regions")).not.toHaveClass(/collapsed/);
  await expect(page.locator("#quiz-sec-regions #quiz-ui")).toBeVisible();
  await expect(page.locator("#quiz-sec-regions #quiz-type")).toHaveCount(0);
});

test("Lakes and Rivers have Name it / Which country, switching answer widget", async ({ page }) => {
  for (const [id, mode] of [["lakes", "lake"], ["rivers", "river"]] as const) {
    await page.click(`[data-quiz-sec="${id}"]`);
    await expect(page.locator(`#quiz-sec-${id}`)).not.toHaveClass(/collapsed/);
    await expect(page.locator(`#${mode}-type .qt-btn`)).toHaveText(["Name it", "Which country"]);
    // Name it (default): search box shown, no country box.
    await expect(page.locator(`#quiz-sec-${id} #name-box`)).toBeVisible();
    await expect(page.locator(`#quiz-sec-${id} #loc-box`)).toBeHidden();
    // Which country: country search + map-click (loc-box), name box hidden.
    await page.click(`#${mode}-type .qt-btn[data-qtype="${mode}country"]`);
    await expect(page.locator(`#quiz-sec-${id} #loc-box`)).toBeVisible();
    await expect(page.locator(`#quiz-sec-${id} #loc-mode`)).toBeHidden();
    await expect(page.locator(`#quiz-sec-${id} #name-box`)).toBeHidden();
  }
});
