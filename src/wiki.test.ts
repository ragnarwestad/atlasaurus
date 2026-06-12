import { describe, it, expect } from "vitest";
import { makeWikiUrl, wikiUrl, cityWikiUrl, escapeHtml } from "./wiki";
import { WIKI_OVERRIDES, CITY_OVERRIDES } from "./config";

describe("makeWikiUrl", () => {
  it("builds an en.wikipedia URL with underscores and encoding", () => {
    expect(makeWikiUrl("New Zealand")).toBe("https://en.wikipedia.org/wiki/New_Zealand");
    expect(makeWikiUrl("São Tomé and Príncipe")).toBe(
      "https://en.wikipedia.org/wiki/" + encodeURIComponent("São_Tomé_and_Príncipe"),
    );
  });
});

describe("wikiUrl / cityWikiUrl overrides", () => {
  it("applies WIKI_OVERRIDES when present, passes through otherwise", () => {
    for (const [name, target] of Object.entries(WIKI_OVERRIDES).slice(0, 3)) {
      expect(wikiUrl(name)).toBe(makeWikiUrl(target));
    }
    expect(wikiUrl("Norway")).toBe(WIKI_OVERRIDES["Norway"] ? makeWikiUrl(WIKI_OVERRIDES["Norway"]) : makeWikiUrl("Norway"));
  });
  it("applies CITY_OVERRIDES when present", () => {
    for (const [name, target] of Object.entries(CITY_OVERRIDES).slice(0, 3)) {
      expect(cityWikiUrl(name)).toBe(makeWikiUrl(target));
    }
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, > and double quotes", () => {
    expect(escapeHtml('<a href="x">Fish & Chips</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;Fish &amp; Chips&lt;/a&gt;",
    );
  });
  it("stringifies non-strings", () => {
    expect(escapeHtml(42 as unknown as string)).toBe("42");
  });
});
