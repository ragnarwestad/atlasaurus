import { expect, test } from "@playwright/test";

// Guess mode for Mountains is offline-deterministic: the peak set is bundled
// (src/peaks.ts), not fetched from a CDN, so the labels are stable. Peak labels
// live in the DOM at all zooms (their *display* is zoom-gated by .phys-labels-on),
// so we can read their text via textContent without zooming/panning.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".peak-label", { state: "attached", timeout: 20_000 });
});

test("peaks start anonymized as 'Mountain ?'", async ({ page }) => {
  const labels = await page.locator(".peak-label").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((t) => t.trim() === "Mountain ?")).toBe(true);
});

test("the Mountains toggle reveals and re-hides all peak names", async ({ page }) => {
  const labels = page.locator(".peak-label");

  await page.check("#show-mountains");
  const revealed = (await labels.allTextContents()).map((t) => t.trim());
  expect(revealed).toContain("Mount Everest"); // an ≥6000 m peak, shown at world view
  expect(revealed.every((t) => t !== "Mountain ?")).toBe(true);

  await page.uncheck("#show-mountains");
  const reHidden = (await labels.allTextContents()).map((t) => t.trim());
  expect(reHidden.every((t) => t === "Mountain ?")).toBe(true);
});

test("clicking a peak reveals just that one and opens its detail box", async ({ page }) => {
  // Click the centre of a peak icon that sits inside the viewport AND is the
  // topmost element there — so an overlapping city/capital marker (the map shows
  // those anonymously too) can't steal the click.
  const point = await page.evaluate(() => {
    const map = document.querySelector("#map")!.getBoundingClientRect();
    for (const el of Array.from(document.querySelectorAll(".peak-icon"))) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!(r.width > 0 && cx > map.left + 20 && cx < map.right - 20 && cy > map.top + 20 && cy < map.bottom - 20)) continue;
      const top = document.elementFromPoint(cx, cy);
      if (top && el.contains(top)) return { x: cx, y: cy };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);

  // The feature detail box opens for a peak.
  await expect(page.locator("#countryinfo")).toBeVisible();
  await expect(page.locator("#countryinfo .ci-sub")).toHaveText(/Mountain peak/);
  const revealedName = await page.locator("#countryinfo .ci-title a").first()
    .evaluate((a) => (a.childNodes[0]?.textContent || "").trim());
  expect(revealedName.length).toBeGreaterThan(0);

  // That peak's on-map label is now its real name; others stay "Mountain ?".
  const labels = (await page.locator(".peak-label").allTextContents()).map((t) => t.trim());
  expect(labels).toContain(revealedName);
  expect(labels.some((t) => t === "Mountain ?")).toBe(true);
});
