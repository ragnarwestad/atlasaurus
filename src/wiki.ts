import { WIKI_OVERRIDES, CITY_OVERRIDES } from "./config";

export function makeWikiUrl(title: string): string {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
}

export function wikiUrl(name: string): string {
  return makeWikiUrl(WIKI_OVERRIDES[name] || name);
}

export function cityWikiUrl(name: string): string {
  return makeWikiUrl(CITY_OVERRIDES[name] || name);
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
