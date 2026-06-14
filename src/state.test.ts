import { describe, it, expect, afterEach } from "vitest";
import {
  app, countries, fmtInt, featureLabel, realCountries, entryForLayer, popOf, areaOf,
  layerCenter, placeMinZoom, quizRevealsCountries, quizRevealsCities,
  quizRevealsPeaks, quizRevealsRivers, quizRevealsLakes,
  questionPoints, tierByRank, roundMix, roundMaxPoints, roundComplete, questionNumber,
  nearestDistractors, type NamedPoint, type CountryEntry,
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

describe("questionPoints", () => {
  it("awards the tier value for an unaided correct answer", () => {
    expect(questionPoints(true, "easy", 0)).toBe(5);
    expect(questionPoints(true, "medium", 0)).toBe(8);
    expect(questionPoints(true, "hard", 0)).toBe(10);
  });
  it("knocks 2 off per hint used", () => {
    expect(questionPoints(true, "hard", 1)).toBe(8);
    expect(questionPoints(true, "hard", 2)).toBe(6);
    expect(questionPoints(true, "medium", 1)).toBe(6);
  });
  it("floors a correct answer at 1, never 0", () => {
    expect(questionPoints(true, "easy", 2)).toBe(1); // 5 - 4 = 1
  });
  it("awards nothing for a wrong answer", () => {
    expect(questionPoints(false, "hard", 0)).toBe(0);
  });
});

describe("tierByRank", () => {
  it("splits a pool into terciles (most famous = easy)", () => {
    expect(tierByRank(0, 99)).toBe("easy");
    expect(tierByRank(40, 99)).toBe("medium");
    expect(tierByRank(80, 99)).toBe("hard");
  });
});

describe("roundMix / roundMaxPoints", () => {
  it("uses a fixed ~40/40/20 mix", () => {
    expect(roundMix(10)).toEqual({ easy: 4, medium: 4, hard: 2 });
    expect(roundMix(5)).toEqual({ easy: 2, medium: 2, hard: 1 });
    expect(roundMix(20)).toEqual({ easy: 8, medium: 8, hard: 4 });
  });
  it("gives a deterministic max for a balanced round", () => {
    expect(roundMaxPoints(10)).toBe(4 * 5 + 4 * 8 + 2 * 10); // 72
  });
});

describe("roundComplete", () => {
  it("is true once the answered count reaches the round size", () => {
    expect(roundComplete(9, 10)).toBe(false);
    expect(roundComplete(10, 10)).toBe(true);
    expect(roundComplete(11, 10)).toBe(true);
  });
});

describe("questionNumber", () => {
  it("points at the question being answered (total + 1) when unanswered", () => {
    expect(questionNumber(0, false, 10)).toBe(1);
    expect(questionNumber(3, false, 10)).toBe(4);
  });
  it("stays on the just-answered question (total) right after answering", () => {
    expect(questionNumber(1, true, 10)).toBe(1);
    expect(questionNumber(4, true, 10)).toBe(4);
  });
  it("never exceeds the round size", () => {
    expect(questionNumber(10, true, 10)).toBe(10);
    expect(questionNumber(10, false, 10)).toBe(10);
  });
});

describe("nearestDistractors", () => {
  const target: NamedPoint = { name: "Oslo", lat: 59.9, lng: 10.7 };
  const pool: NamedPoint[] = [
    { name: "Oslo", lat: 59.9, lng: 10.7 },        // the target itself
    { name: "Stockholm", lat: 59.3, lng: 18.1 },
    { name: "Copenhagen", lat: 55.7, lng: 12.6 },
    { name: "Sydney", lat: -33.9, lng: 151.2 },
    { name: "Tokyo", lat: 35.7, lng: 139.7 },
  ];

  it("returns the n nearest names, closest first, excluding the target", () => {
    expect(nearestDistractors(target, pool, 2)).toEqual(["Stockholm", "Copenhagen"]);
  });
  it("never includes the target name", () => {
    expect(nearestDistractors(target, pool, 4)).not.toContain("Oslo");
  });
  it("de-duplicates names and caps at n", () => {
    const dupes: NamedPoint[] = [...pool, { name: "Stockholm", lat: 59.3, lng: 18.1 }];
    const out = nearestDistractors(target, dupes, 3);
    expect(out).toHaveLength(3);
    expect(out.filter((x) => x === "Stockholm")).toHaveLength(1);
  });
});
