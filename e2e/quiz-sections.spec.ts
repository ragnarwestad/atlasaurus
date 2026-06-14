import { expect, test, type Page } from "@playwright/test";

// Covers the Challenge flow: Start (configure category / type / length) → Playing
// (the question UI) → Finished (summary). Offline-safe — the play-through tests
// use Mountains, whose peak data is bundled (no CDN); other categories are only
// exercised for static UI (which controls show), never for data-dependent counts.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#mode-tabs .mode-tab");
  await page.click('.mode-tab[data-mode="quiz"]');
  await page.check('#quiz-subtabs input[value="challenge"]'); // the scored quiz
  await expect(page.locator("#challenge-panel")).toBeVisible();
});

// Configure + start a Mountains quiz (PEAKS is bundled, so it runs offline).
async function startMountains(page: Page, size?: number): Promise<void> {
  await page.click('#quiz-cat .cat-btn[data-cat="mountains"]');
  if (size) await page.click(`#round-size .rs-btn[data-size="${size}"]`);
  await page.click("#quiz-start-btn");
  await expect(page.locator("#quiz-ui")).toBeVisible();
}
// Answer n questions (any answer counts — we only need to advance the round).
async function playRound(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.fill("#name-input", "a");
    await page.locator("#name-results li").first().click();
    await page.click("#quiz-next"); // the final Next reveals the summary
  }
}

test("Start screen shows category, type and length, with Countries default", async ({ page }) => {
  await expect(page.locator("#quiz-start")).toBeVisible();
  await expect(page.locator("#quiz-start .qz-phase-title")).toHaveText("Set up your quiz");
  await expect(page.locator("#quiz-ui")).toBeHidden();
  await expect(page.locator("#quiz-summary")).toBeHidden();
  await expect(page.locator("#quiz-cat .cat-btn")).toHaveCount(6);
  await expect(page.locator('#quiz-cat .cat-btn[data-cat="country"]')).toHaveClass(/active/);
  await expect(page.locator("#quiz-type")).toBeVisible(); // the country type row
  await expect(page.locator('#quiz-type .qt-btn[data-qtype="name"]')).toHaveClass(/active/);
});

test("selecting a category swaps in its type row", async ({ page }) => {
  await page.click('#quiz-cat .cat-btn[data-cat="city"]');
  await expect(page.locator("#city-type")).toBeVisible();
  await expect(page.locator("#quiz-type")).toBeHidden();
  await expect(page.locator("#city-type .qt-btn")).toHaveText(["Name it", "Which country"]);
});

test("Regions has no type row, just a note", async ({ page }) => {
  await page.click('#quiz-cat .cat-btn[data-cat="continent"]');
  await expect(page.locator("#quiz-type-field .type-row:not([hidden])")).toHaveCount(0);
  await expect(page.locator("#quiz-type-field .type-none")).toBeVisible();
});

test("starting a quiz enters the playing phase", async ({ page }) => {
  await startMountains(page);
  await expect(page.locator("#quiz-start")).toBeHidden();
  await expect(page.locator("#quiz-summary")).toBeHidden();
  await expect(page.locator("#quiz-playphase")).toHaveText("Playing — Q 1/10");
  await expect(page.locator("#quiz-playinfo")).toHaveText("Mountains · Name it");
  await expect(page.locator("#quiz-score")).toHaveText(/^0 pts/);
});

test("Mountains 'Name it' answers via a name search box, not choice buttons", async ({ page }) => {
  await startMountains(page);
  await expect(page.locator("#name-box")).toBeVisible();
  await expect(page.locator("#quiz-choices")).toBeHidden();
  await page.fill("#name-input", "ever");
  await expect(page.locator("#name-results li").first()).toBeVisible();
});

test("Mountains 'Which country' answers via the country search box", async ({ page }) => {
  await page.click('#quiz-cat .cat-btn[data-cat="mountains"]');
  await page.click('#mtn-type .qt-btn[data-qtype="peakcountry"]');
  await page.click("#quiz-start-btn");
  await expect(page.locator("#loc-box")).toBeVisible();
  await expect(page.locator("#loc-input")).toBeVisible();
  await expect(page.locator("#name-box")).toBeHidden();
});

test("the instruction states the full reward up front, then the result replaces it", async ({ page }) => {
  await startMountains(page);
  const feedback = page.locator("#quiz-feedback");
  await expect(feedback).toHaveText("Which mountain is marked? Search and pick it. (5 pts)");
  await page.fill("#name-input", "ever");
  await page.locator("#name-results li").first().click();
  await expect(feedback).not.toContainText("(5 pts)");
});

test("the 5-option help is worth fewer points and shows its own hint", async ({ page }) => {
  await startMountains(page);
  await page.click("#quiz-help");
  await expect(page.locator("#name-box")).toBeHidden();
  await expect(page.locator("#quiz-feedback")).toHaveText("Pick the right one (2 pts)");
  const choices = page.locator("#quiz-choices button");
  await expect(choices).toHaveCount(5);
  await choices.first().click();
  await expect(page.locator("#quiz-score")).toHaveText(/^[02] pts/);
});

test("Quit returns to the Start screen", async ({ page }) => {
  await startMountains(page);
  await page.click("#quiz-quit");
  await expect(page.locator("#quiz-start")).toBeVisible();
  await expect(page.locator("#quiz-ui")).toBeHidden();
});

test("choosing a length runs the round to that length", async ({ page }) => {
  await startMountains(page, 5);
  await expect(page.locator("#quiz-playphase")).toHaveText("Playing — Q 1/5");
  await playRound(page, 5);
  await expect(page.locator("#quiz-summary")).toBeVisible();
  await expect(page.locator("#quiz-summary .qs-score")).toContainText("/ 25 pts");
  await expect(page.locator("#quiz-summary .qs-score")).toContainText("/ 5 correct");
});

test("a finished round offers Play again and New quiz", async ({ page }) => {
  await startMountains(page, 5);
  await playRound(page, 5);
  await expect(page.locator("#quiz-ui")).toBeHidden();
  // New quiz returns to Start.
  await page.click("#quiz-newquiz");
  await expect(page.locator("#quiz-start")).toBeVisible();
  // Play again from a fresh round.
  await startMountains(page, 5);
  await playRound(page, 5);
  await page.click("#quiz-again");
  await expect(page.locator("#quiz-ui")).toBeVisible();
  await expect(page.locator("#quiz-playphase")).toHaveText("Playing — Q 1/5");
  await expect(page.locator("#quiz-score")).toHaveText(/^0 pts/);
});

test("a record persists across a reload (seen in the Score modal)", async ({ page }) => {
  await startMountains(page, 5);
  await playRound(page, 5);
  const summary = await page.locator("#quiz-summary .qs-score").textContent();
  const best = Number(/^(\d+) \//.exec(summary || "")?.[1] ?? "-1");
  await page.reload();
  await page.waitForSelector("#app-menu-btn");
  await page.click("#app-menu-btn");
  await page.click('.app-menu-item[data-menu="score"]');
  const row = page.locator(".score-row").first();
  await expect(row.locator(".sc-label")).toHaveText("Name it · 5");
  await expect(row.locator(".sc-pts")).toHaveText(best + "/25");
});

test("resetting a record in the Score modal clears it everywhere", async ({ page }) => {
  await startMountains(page, 5);
  await playRound(page, 5);
  // Open Score from the header menu and reset the one record.
  await page.click("#app-menu-btn");
  await page.click('.app-menu-item[data-menu="score"]');
  await expect(page.locator(".score-row")).toHaveCount(1);
  await page.locator(".score-row .sc-reset").click();
  await expect(page.locator("#score-list")).toContainText("No quizzes played yet.");
});
