import { describe, it, expect, afterEach } from "vitest";
import {
  app, countries, fmtInt, realCountries, entryForLayer, popOf, areaOf,
  layerCenter, placeMinZoom, type CountryEntry,
} from "./state";

// Minimal fake CountryEntry — only the properties the helpers actually read.
function fakeEntry(over: Partial<CountryEntry> & { props?: any; geometry?: any } = {}): CountryEntry {
  const { props, geometry, ...rest } = over;
  return {
    name: "Testland",
    iso: "TST",
    iso2: "ts",
    layer: { feature: { properties: props || {}, geometry: geometry || null } } as any,
    ...rest,
  } as CountryEntry;
}

afterEach(() => {
  countries.length = 0;     // shared module state — reset between tests
  app.countryData = null;
});

describe("fmtInt", () => {
  it("rounds and formats with en-US thousands separators", () => {
    expect(fmtInt(1234567.4)).toBe("1,234,567");
    expect(fmtInt(999.6)).toBe("1,000");
  });
});

describe("realCountries", () => {
  it("excludes the Antarctica landmass", () => {
    countries.push(fakeEntry({ name: "Norway" }), fakeEntry({ name: "Antarctica", isLandmass: true }));
    expect(realCountries().map((c) => c.name)).toEqual(["Norway"]);
  });
});

describe("entryForLayer", () => {
  it("finds the entry owning a layer, null otherwise", () => {
    const e = fakeEntry();
    countries.push(e);
    expect(entryForLayer(e.layer)).toBe(e);
    expect(entryForLayer({} as any)).toBeNull();
    expect(entryForLayer(null)).toBeNull();
  });
});

describe("popOf / areaOf", () => {
  it("reads POP_EST from the Natural Earth feature, 0 when missing", () => {
    expect(popOf(fakeEntry({ props: { POP_EST: 5500000 } }))).toBe(5500000);
    expect(popOf(fakeEntry())).toBe(0);
  });
  it("reads area from the cached mledoze data keyed by ISO-3, 0 when absent", () => {
    const e = fakeEntry({ iso: "NOR" });
    expect(areaOf(e)).toBe(0); // dataset not loaded yet
    app.countryData = { NOR: { area: 323802 } };
    expect(areaOf(e)).toBe(323802);
    expect(areaOf(fakeEntry({ iso: "SWE" }))).toBe(0);
  });
});

describe("layerCenter", () => {
  it("returns the polylabel center of the largest part as [lat, lng]", () => {
    const e = fakeEntry({
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    });
    const c = layerCenter(e);
    expect(c).not.toBeNull();
    expect(c![0]).toBeCloseTo(5, 0);
    expect(c![1]).toBeCloseTo(5, 0);
  });
  it("returns null when there is no usable geometry", () => {
    expect(layerCenter(fakeEntry())).toBeNull();
  });
});

describe("placeMinZoom", () => {
  it("prefers Natural Earth min_zoom", () => {
    expect(placeMinZoom({ min_zoom: 4.7, scalerank: 1, pop_max: 9e9 })).toBe(4.7);
  });
  it("falls back to scalerank", () => {
    expect(placeMinZoom({ scalerank: 3, pop_max: 9e9 })).toBe(3);
  });
  it("falls back to population-based buckets", () => {
    expect(placeMinZoom({ pop_max: 6e6 })).toBe(1);
    expect(placeMinZoom({ pop_max: 2e6 })).toBe(3);
    expect(placeMinZoom({ pop_max: 3e5 })).toBe(5);
    expect(placeMinZoom({})).toBe(7);
  });
});
