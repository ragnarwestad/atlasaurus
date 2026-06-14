import { expect, test } from "@playwright/test";

// Top modes: Explore (browse) and Quiz, where Quiz holds two sub-tabs —
// Practice (self-paced guess) and Challenge (scored rounds). Explore and Practice
// keep separate Map-options / Reveal toggle panels. Offline-safe (static UI only).

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#mode-tabs .mode-tab");
});

test("opens in Explore (browse) with its own Map options", async ({ page }) => {
  await expect(page.locator("#explore-panel")).toBeVisible();
  await expect(page.locator("#quiz-panel")).toBeHidden();
  await expect(page.locator("#explore-panel #show-names")).toBeVisible(); // Explore's own toggles
});

test("Quiz tab opens Challenge by default", async ({ page }) => {
  await page.click('.mode-tab[data-mode="quiz"]');
  await expect(page.locator("#quiz-panel")).toBeVisible();
  await expect(page.locator("#explore-panel")).toBeHidden();
  await expect(page.locator('#quiz-subtabs input[value="challenge"]')).toBeChecked();
  await expect(page.locator("#challenge-panel")).toBeVisible();
  await expect(page.locator("#practice-panel")).toBeHidden();
  await expect(page.locator("#challenge-panel #quiz-start")).toBeVisible(); // the Start screen
  await expect(page.locator("#quiz-cat .cat-btn")).toHaveCount(6); // six categories to choose
});

test("switching Challenge <-> Practice swaps the sub-panel", async ({ page }) => {
  await page.click('.mode-tab[data-mode="quiz"]'); // Challenge by default
  await page.check('#quiz-subtabs input[value="practice"]');
  await expect(page.locator("#practice-panel")).toBeVisible();
  await expect(page.locator("#challenge-panel")).toBeHidden();
  await expect(page.locator("#practice-panel #pr-show-names")).toBeVisible(); // Practice's own toggles
  await page.check('#quiz-subtabs input[value="challenge"]');
  await expect(page.locator("#challenge-panel")).toBeVisible();
  await expect(page.locator("#practice-panel")).toBeHidden();
});

test("Explore and Practice toggle panels are independent", async ({ page }) => {
  // Turn Cities on in Explore.
  await page.check("#show-cities");
  // Switch to Quiz > Practice — its own Cities toggle is untouched (off).
  await page.click('.mode-tab[data-mode="quiz"]');
  await expect(page.locator("#pr-show-cities")).not.toBeChecked();
  // Back to Explore — still on.
  await page.click('.mode-tab[data-mode="explore"]');
  await expect(page.locator("#show-cities")).toBeChecked();
  await page.uncheck("#show-cities"); // cleanup persisted state
});
