import { describe, it, expect } from "vitest";
import { ringArea, normRing, wrapLng, ringCentroid, allPolygonParts, centerOf, lineLengthKm, type Ring } from "./geo";

const square = (x0: number, y0: number, size: number): Ring => [
  [x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0],
];

describe("ringArea", () => {
  it("computes the shoelace area of a unit square", () => {
    expect(ringArea(square(0, 0, 1))).toBeCloseTo(1);
  });
  it("is winding-direction independent (absolute)", () => {
    expect(ringArea(square(0, 0, 2).slice().reverse())).toBeCloseTo(4);
  });
});

describe("normRing (antimeridian unwrap)", () => {
  it("keeps a ring crossing ±180° continuous", () => {
    const ring: Ring = [[179, 0], [-179, 0], [-179, 1], [179, 1], [179, 0]];
    const out = normRing(ring);
    // No consecutive longitude jump may exceed 180° after unwrapping.
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i][0] - out[i - 1][0])).toBeLessThan(180);
    }
    expect(out[1][0]).toBe(181); // -179 unwrapped past the antimeridian
  });
  it("leaves a normal ring untouched", () => {
    expect(normRing(square(0, 0, 1))).toEqual(square(0, 0, 1));
  });
});

describe("wrapLng", () => {
  it("wraps back into [-180, 180)", () => {
    expect(wrapLng(181)).toBe(-179);
    expect(wrapLng(-181)).toBe(179);
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(360)).toBe(0);
  });
});

describe("ringCentroid", () => {
  it("averages the vertices, skipping the closing duplicate", () => {
    const [x, y] = ringCentroid(square(0, 0, 2));
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });
});

describe("allPolygonParts", () => {
  it("returns [] for missing/unsupported geometry", () => {
    expect(allPolygonParts(null)).toEqual([]);
    expect(allPolygonParts({ type: "Point", coordinates: [0, 0] })).toEqual([]);
  });
  it("sorts MultiPolygon parts largest-first (the main landmass is parts[0])", () => {
    const geom = {
      type: "MultiPolygon",
      coordinates: [[square(0, 0, 1)], [square(10, 10, 5)]],
    };
    const parts = allPolygonParts(geom);
    expect(parts).toHaveLength(2);
    expect(parts[0].area).toBeCloseTo(25);
    expect(parts[1].area).toBeCloseTo(1);
  });
});

describe("centerOf", () => {
  it("returns [lat, lng] inside a simple square", () => {
    const [lat, lng] = centerOf([square(0, 0, 10)]);
    expect(lat).toBeCloseTo(5, 0);
    expect(lng).toBeCloseTo(5, 0);
  });
  it("does not land mid-ocean for an antimeridian-spanning shape", () => {
    // A 20°-wide square straddling ±180° (Chukotka/Fiji case). Without the
    // unwrap+wrap dance the center would come out near lng 0.
    const geom = {
      type: "Polygon",
      coordinates: [[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]] as Ring],
    };
    const [lat, lng] = centerOf(allPolygonParts(geom)[0].rings);
    expect(lat).toBeCloseTo(5, 0);
    expect(Math.abs(lng)).toBeGreaterThanOrEqual(170); // near the antimeridian, not Greenwich
  });
});

describe("lineLengthKm", () => {
  it("measures ~111.2 km for 1° along the equator", () => {
    const km = lineLengthKm({ type: "LineString", coordinates: [[0, 0], [1, 0]] });
    expect(km).toBeGreaterThan(111);
    expect(km).toBeLessThan(111.4);
  });
  it("sums MultiLineString segments", () => {
    const one = lineLengthKm({ type: "LineString", coordinates: [[0, 0], [1, 0]] });
    const two = lineLengthKm({
      type: "MultiLineString",
      coordinates: [[[0, 0], [1, 0]], [[10, 0], [11, 0]]],
    });
    expect(two).toBeCloseTo(2 * one, 6);
  });
  it("returns 0 for missing/non-line geometry", () => {
    expect(lineLengthKm(null)).toBe(0);
    expect(lineLengthKm({ type: "Polygon", coordinates: [] })).toBe(0);
  });
});
