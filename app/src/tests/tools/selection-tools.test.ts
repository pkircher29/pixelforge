import { describe, expect, it } from "vitest";
import { Raster, Rect, Selection } from "../../lib/engine";
import { discIndices, enhanceRegion, growRegion, labOf, rgbToLab, shrinkRegion } from "../../lib/tools/region-grow";
import { edgeMapOf, snapToEdge } from "../../lib/tools/edge-map";
import { MagneticLassoTool } from "../../lib/tools/magnetic-lasso";
import { borderSelection, colorRangeSelection, growSelection, similarSelection, smoothSelection } from "../../lib/tools/select-ops";
import { transformSelection } from "../../lib/tools/transform-selection";

/** Left half red, right half blue. */
function twoColor(w = 40, h = 20): Raster {
  const r = Raster.filled(w, h, { r: 220, g: 30, b: 30, a: 255 });
  r.fill({ r: 30, g: 40, b: 220, a: 255 }, Rect.make(w / 2, 0, w / 2, h));
  return r;
}

describe("quick selection growth", () => {
  it("Lab conversion: white ≈ L100, black ≈ L0", () => {
    expect(rgbToLab(255, 255, 255)[0]).toBeCloseTo(100, 0);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 0);
  });

  it("grows across the brushed colour and stops at the other colour", () => {
    const img = twoColor();
    const lab = labOf(img);
    const region = new Uint8Array(40 * 20);
    const added = growRegion(lab, 40, 20, edgeMapOf(img), discIndices(40, 20, 5, 10, 3), region);
    expect(added).toBe(20 * 20);
    expect(region[10 * 40 + 19]).toBe(255);
    expect(region[10 * 40 + 21]).toBe(0);
  });

  it("subtract shrinks the matching part only", () => {
    const img = twoColor();
    const lab = labOf(img);
    const region = new Uint8Array(40 * 20).fill(255);
    shrinkRegion(lab, 40, 20, discIndices(40, 20, 30, 10, 2), region);
    expect(region[10 * 40 + 5]).toBe(255);
    expect(region[10 * 40 + 30]).toBe(0);
  });

  it("an edge stops growth even between similar colours", () => {
    const img = Raster.filled(30, 10, { r: 120, g: 120, b: 120, a: 255 });
    img.fill({ r: 0, g: 0, b: 0, a: 255 }, Rect.make(15, 0, 1, 10));
    const region = new Uint8Array(300);
    growRegion(labOf(img), 30, 10, edgeMapOf(img), discIndices(30, 10, 4, 5, 2), region, { tolerance: 200 });
    expect(region[5 * 30 + 25]).toBe(0);
  });

  it("auto-enhance removes single-pixel noise", () => {
    const r = new Uint8Array(25);
    r[12] = 255;
    expect(enhanceRegion(r, 5, 5)[12]).toBe(0);
  });
});

describe("magnetic lasso edge snapping", () => {
  it("snaps to a vertical edge within the width and ignores it outside", () => {
    const img = Raster.filled(40, 40, { r: 20, g: 20, b: 20, a: 255 });
    img.fill({ r: 240, g: 240, b: 240, a: 255 }, Rect.make(20, 0, 20, 40));
    const e = edgeMapOf(img);
    const hit = snapToEdge(e, 15, 20, 8, e.max * 0.3)!;
    expect(hit.x === 19 || hit.x === 20).toBe(true);
    expect(snapToEdge(e, 5, 20, 4, e.max * 0.3)).toBeNull();
  });

  it("fastening frequency maps to spacing", () => {
    expect(MagneticLassoTool.fastenSpacing(100)).toBeLessThan(MagneticLassoTool.fastenSpacing(0));
    expect(MagneticLassoTool.fastenSpacing(100)).toBeGreaterThanOrEqual(5);
  });
});

describe("Select menu modify ops", () => {
  const box = () => Selection.fromRect(40, 40, Rect.make(10, 10, 20, 20));

  it("Border selects a band around the edge", () => {
    const b = borderSelection(box(), 4);
    expect(b.get(20, 20)).toBe(0);
    expect(b.get(10, 20)).toBeGreaterThan(100);
    expect(b.get(2, 2)).toBe(0);
  });

  it("Smooth removes a one-pixel spur", () => {
    const s = box();
    s.mask[20 * 40 + 31] = 255;
    s.invalidate();
    expect(smoothSelection(s, 1).get(31, 20)).toBe(0);
  });

  it("Grow adds connected similar pixels; Similar adds disconnected ones", () => {
    const img = Raster.filled(40, 10, { r: 0, g: 0, b: 0, a: 255 });
    img.fill({ r: 200, g: 0, b: 0, a: 255 }, Rect.make(0, 0, 10, 10));
    img.fill({ r: 200, g: 0, b: 0, a: 255 }, Rect.make(30, 0, 10, 10));
    const seed = Selection.fromRect(40, 10, Rect.make(2, 2, 2, 2));
    const g = growSelection(seed, img, 10);
    expect(g.get(9, 9)).toBe(255);
    expect(g.get(35, 5)).toBe(0);
    expect(similarSelection(seed, img, 10).get(35, 5)).toBe(255);
  });

  it("Color Range sampled + hue / tone presets", () => {
    const img = twoColor();
    const s = colorRangeSelection(img, "sampled", [{ r: 220, g: 30, b: 30, a: 255 }], 40, false);
    expect(s.get(5, 5)).toBe(255);
    expect(s.get(35, 5)).toBe(0);
    expect(colorRangeSelection(img, "blues", [], 0, false).get(35, 5)).toBe(255);
    expect(colorRangeSelection(img, "reds", [], 0, true).get(5, 5)).toBe(0);
    const tones = Raster.filled(4, 1, { r: 250, g: 250, b: 250, a: 255 });
    expect(colorRangeSelection(tones, "highlights", [], 0, false).get(0, 0)).toBeGreaterThan(200);
  });

  it("Transform Selection moves and scales the mask", () => {
    const s = box();
    const moved = transformSelection(s, s.bbox!, { tx: 5, ty: 0, sx: 1, sy: 1, angle: 0 });
    expect(moved.get(12, 20)).toBe(0);
    expect(moved.get(33, 20)).toBeGreaterThan(200);
    const big = transformSelection(s, s.bbox!, { tx: 0, ty: 0, sx: 1.5, sy: 1.5, angle: 0 });
    expect(big.bbox!.w).toBeGreaterThanOrEqual(29);
  });
});
