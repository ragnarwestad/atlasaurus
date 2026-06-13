import { expect, test } from "@playwright/test";

// Covers the help modal's Explore/Quiz tabs (mirrors the sidebar mode tabs),
// internal panel scrolling, and the fixed "Data & credits" footer.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#brand .help-btn");
});

test("Explore and Quiz show as two side-by-side tabs, Explore active", async ({ page }) => {
  await page.click("#brand .help-btn");
  await expect(page.locator("#help-modal")).toBeVisible();

  const tabs = page.locator(".help-tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveText("Explore");
  await expect(tabs.nth(1)).toHaveText("Quiz");

  // Same row, Quiz to the right of Explore.
  const a = (await tabs.nth(0).boundingBox())!;
  const b = (await tabs.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(3);
  expect(b.x).toBeGreaterThan(a.x + a.width - 5);

  await expect(tabs.nth(0)).toHaveClass(/active/);
  await expect(page.locator('.help-panel[data-help-panel="explore"]')).toBeVisible();
  await expect(page.locator('.help-panel[data-help-panel="quiz"]')).toBeHidden();
});

test("clicking a tab swaps the visible panel", async ({ page }) => {
  await page.click("#brand .help-btn");
  await page.click('.help-tab[data-help-tab="quiz"]');

  await expect(page.locator('.help-tab[data-help-tab="quiz"]')).toHaveClass(/active/);
  await expect(page.locator('.help-panel[data-help-panel="quiz"]')).toBeVisible();
  await expect(page.locator('.help-panel[data-help-panel="explore"]')).toBeHidden();
});

test("the panel scrolls internally while the card frame stays put", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 520 });
  await page.click("#brand .help-btn");
  await page.click('.help-tab[data-help-tab="quiz"]'); // the taller panel

  const m = await page.evaluate(() => {
    const card = document.querySelector(".help-card") as HTMLElement;
    const panel = document.querySelector(".help-panel:not([hidden])") as HTMLElement;
    return {
      cardScrolls: card.scrollHeight > card.clientHeight + 1,
      panelScrollable: panel.scrollHeight > panel.clientHeight + 1,
    };
  });
  expect(m.cardScrolls).toBe(false);
  expect(m.panelScrollable).toBe(true);

  // After scrolling the panel to the bottom, the footer is still inside the card.
  await page.evaluate(() => {
    (document.querySelector(".help-panel:not([hidden])") as HTMLElement).scrollTop = 99_999;
  });
  const footerInside = await page.evaluate(() => {
    const card = (document.querySelector(".help-card") as HTMLElement).getBoundingClientRect();
    const credits = (document.querySelector(".help-credits") as HTMLElement).getBoundingClientRect();
    return credits.bottom <= card.bottom + 1 && credits.top >= card.top;
  });
  expect(footerInside).toBe(true);
});

test("the modal opens on the tab matching the sidebar mode", async ({ page }) => {
  await page.click('.mode-tab[data-mode="quiz"]'); // put the sidebar in Quiz mode
  await page.click("#brand .help-btn");

  await expect(page.locator(".help-tab.active")).toHaveText("Quiz");
  await expect(page.locator('.help-panel[data-help-panel="quiz"]')).toBeVisible();
});
