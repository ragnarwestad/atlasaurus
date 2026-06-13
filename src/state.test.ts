import { describe, it, expect, afterEach } from "vitest";
import {
  app, countries, fmtInt, featureLabel, realCountries, entryForLayer, popOf, areaOf,
  layerCenter, placeMinZoom, quizRevealsCountries, quizRevealsCities,
  quizRevealsPeaks, quizRevealsRivers, quizRevealsLakes, type CountryEntry,
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
  app.mode = "explore";     // featureLabel is mode-aware; reset to the default
  app.quizAnswered = false; // quiz-reveal helpers read these
  app.quizType = "name";
});

describe("fmtInt", () => {
  it("rounds and formats with en-US thousands separators", () => {
    expect(fmtInt(1234567.4)).toBe("1,234,567");
    expect(fmtInt(999.6)).toBe("1,000");
  });
});

describe("featureLabel", () => {
  it("shows the real name once revealed (in the guess modes)", () => {
    app.mode = "practice";
    expect(featureLabel("Mountain", "Mount Everest", true)).toBe("Mount Everest");
  });
  it("hides the name behind a '<Type> ?' placeholder when not revealed (practice)", () => {
    app.mode = "practice";
    expect(featureLabel("Mountain", "Mount Everest", false)).toBe("Mountain ?");
    expect(featureLabel("Lake", "Lake Victoria", false)).toBe("Lake ?");
  });
  it("always shows the real name in Explore (browse), revealed or not", () => {
    app.mode = "explore";
    expect(featureLabel("Mountain", "Mount Everest", false)).toBe("Mount Everest");
  });
});

describe("quiz reveal predicates", () => {
  it("reveal nothing until a question is answered", () => {
    app.mode = "quiz"; app.quizType = "capital"; app.quizAnswered = false;
    expect(quizRevealsCountries()).toBe(false);
    expect(quizRevealsCities()).toBe(false);
    expect(quizRevealsPeaks()).toBe(false);
  });
  it("reveal all country names after ANY answered round", () => {
    app.mode = "quiz"; app.quizAnswered = true;
    for (const t of ["name", "flag", "capital", "spot", "neighbour", "continent",
      "peakname", "peakcountry", "cityname", "citycountry", "rivername", "rivercountry", "lakename", "lakecountry"] as const) {
      app.quizType = t;
      expect(quizRevealsCountries()).toBe(true);
    }
  });
  it("reveal all city names only after the Cities-section rounds", () => {
    app.mode = "quiz"; app.quizAnswered = true;
    app.quizType = "cityname"; expect(quizRevealsCities()).toBe(true);
    app.quizType = "citycountry"; expect(quizRevealsCities()).toBe(true);
    app.quizType = "capital"; expect(quizRevealsCities()).toBe(false);
  });
  it("reveal each feature's names only after its own Name-it round", () => {
    app.mode = "quiz"; app.quizAnswered = true;
    app.quizType = "peakname"; expect(quizRevealsPeaks()).toBe(true);
    expect(quizRevealsRivers()).toBe(false);
    expect(quizRevealsLakes()).toBe(false);
    app.quizType = "rivername"; expect(quizRevealsRivers()).toBe(true);
    expect(quizRevealsPeaks()).toBe(false);
    app.quizType = "lakename"; expect(quizRevealsLakes()).toBe(true);
    // The "which country" feature rounds don't reveal the feature's own names.
    app.quizType = "peakcountry"; expect(quizRevealsPeaks()).toBe(false);
  });
  it("never reveal outside Quiz mode", () => {
    app.quizAnswered = true; app.quizType = "capital";
    app.mode = "explore"; expect(quizRevealsCountries()).toBe(false);
    app.mode = "practice"; expect(quizRevealsCountries()).toBe(false);
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
