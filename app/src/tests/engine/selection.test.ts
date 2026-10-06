import { describe, expect, it } from "vitest";
import { Raster, Rect, Selection, rgba } from "../../lib/engine";

function count255(s: Selection): number {
  let n = 0;
  for (let i = 0; i < s.mask.length; i++) if (s.mask[i] === 255) n++;
  return n;
}

function coverage(s: Selection): number {
  let n = 0;
  for (let i = 0; i < s.mask.length; i++) n += s.mask[i]!;
  return n / 255;
}

describe("Selection factories and queries", () => {
  it("fromRect, all, none, bbox, isEmpty, contains", () => {
    const s = Selection.fromRect(10, 10, Rect.make(2, 3, 4, 5));
    expect(s.bbox).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    expect(s.isEmpty).toBe(false);
    expect(count255(s)).toBe(20);
    expect(s.contains(2, 3)).toBe(true);
    expect(s.contains(1, 3)).toBe(false);
    expect(s.get(-1, 0)).toBe(0);
    expect(Selection.none(4, 4).isEmpty).toBe(true);
    expect(Selection.all(4, 4).isAll).toBe(true);
    expect(Selection.fromRect(10, 10, Rect.make(20, 20, 5, 5)).isEmpty).toBe(true);
  });

  it("ellipse coverage is close to pi r^2 and AA produces partial values only at the edge", () => {
    const s = Selection.fromEllipse(20, 20, Rect.make(0, 0, 20, 20));
    expect(s.get(9, 9)).toBe(255);
    expect(s.get(10, 10)).toBe(255);
    expect(s.get(0, 0)).toBe(0);
    expect(Math.abs(coverage(s) - Math.PI * 100) / (Math.PI * 100)).toBeLessThan(0.02);
    const hard = Selection.fromEllipse(20, 20, Rect.make(0, 0, 20, 20), false);
    for (let i = 0; i < hard.mask.length; i++) expect(hard.mask[i] === 0 || hard.mask[i] === 255).toBe(true);
  });

  it("polygon scanline fill: exact for an integer square, area-accurate for a triangle", () => {
    const sq = Selection.fromPolygon(10, 10, [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 2, y: 6 },
    ]);
    expect(count255(sq)).toBe(16);
    expect(coverage(sq)).toBeCloseTo(16, 5);
    expect(sq.bbox).toEqual({ x: 2, y: 2, w: 4, h: 4 });
    const tri = Selection.fromPolygon(10, 10, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(Math.abs(coverage(tri) - 50)).toBeLessThan(1);
    const hardTri = Selection.fromPolygon(10, 10, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ], false);
    expect(hardTri.get(0, 0)).toBe(255);
    expect(hardTri.get(9, 9)).toBe(0);
    expect(Selection.fromPolygon(10, 10, [{ x: 0, y: 0 }]).isEmpty).toBe(true);
  });
});

describe("magic wand", () => {
  const img = new Raster(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) img.setPixel(x, y, x < 4 ? rgba(255, 0, 0) : rgba(0, 0, 255));
  }
  img.setPixel(6, 6, rgba(255, 0, 0)); // red island on the blue side
  img.setPixel(1, 1, rgba(250, 0, 0)); // slightly different red

  it("contiguous selects the connected region; global selects every match", () => {
    const contiguous = Selection.fromMagicWand(img, 0, 0, 0, true);
    expect(count255(contiguous)).toBe(31);
    expect(contiguous.contains(6, 6)).toBe(false);
    expect(contiguous.contains(1, 1)).toBe(false);
    const global = Selection.fromMagicWand(img, 0, 0, 0, false);
    expect(count255(global)).toBe(32);
    expect(global.contains(6, 6)).toBe(true);
  });

  it("tolerance widens the match", () => {
    const s = Selection.fromMagicWand(img, 0, 0, 10, true);
    expect(count255(s)).toBe(32);
    expect(s.contains(1, 1)).toBe(true);
    expect(s.contains(4, 0)).toBe(false);
  });

  it("places the result in document space for an offset layer", () => {
    const s = Selection.fromMagicWand(img, 5, 5, 0, true, { size: { w: 20, h: 20 }, offset: { x: 10, y: 10 } });
    expect(s.width).toBe(20);
    expect(s.contains(15, 15)).toBe(true);
    expect(s.contains(16, 16)).toBe(false); // the island
    expect(s.contains(5, 5)).toBe(false);
  });
});

describe("boolean ops, invert, translate", () => {
  const a = Selection.fromRect(10, 10, Rect.make(0, 0, 4, 4));
  const b = Selection.fromRect(10, 10, Rect.make(2, 2, 4, 4));

  it("add / intersect / subtract", () => {
    expect(count255(a.add(b))).toBe(28);
    expect(count255(a.intersect(b))).toBe(4);
    expect(count255(a.subtract(b))).toBe(12);
    expect(a.subtract(b).contains(3, 3)).toBe(false);
    expect(a.subtract(b).contains(0, 0)).toBe(true);
    expect(count255(a)).toBe(16); // inputs untouched
  });

  it("invert and size mismatch", () => {
    expect(Selection.none(4, 4).invert().isAll).toBe(true);
    expect(Selection.all(4, 4).invert().isEmpty).toBe(true);
    expect(() => a.add(Selection.none(3, 3))).toThrow();
  });

  it("translate shifts and clips", () => {
    const t = a.translate(8, 8);
    expect(t.bbox).toEqual({ x: 8, y: 8, w: 2, h: 2 });
  });
});

describe("feather / expand / contract", () => {
  it("feather is symmetric, conserves coverage and keeps a full selection full", () => {
    const s = Selection.fromRect(21, 21, Rect.make(8, 8, 5, 5)).feather(2);
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        expect(s.get(x, y)).toBe(s.get(20 - x, y));
        expect(s.get(x, y)).toBe(s.get(x, 20 - y));
      }
    }
    // A 5 px box blurred with sigma 2 peaks at erf(2.5 / (2 sqrt 2))^2 ~ 0.62 -> ~159.
    expect(s.get(10, 10)).toBeGreaterThan(150);
    expect(s.get(10, 10)).toBeLessThan(170);
    expect(s.get(10, 10)).toBeGreaterThan(s.get(8, 10));
    expect(s.get(0, 0)).toBe(0);
    expect(Math.abs(coverage(s) - 25) / 25).toBeLessThan(0.01);
    expect(Selection.all(8, 8).feather(3).isAll).toBe(true);
    expect(Selection.none(8, 8).feather(3).isEmpty).toBe(true);
  });

  it("expand uses a circular structuring element", () => {
    const e = Selection.fromRect(20, 20, Rect.make(5, 5, 3, 3)).expand(2);
    expect(e.bbox).toEqual({ x: 3, y: 3, w: 7, h: 7 });
    expect(e.contains(6, 3)).toBe(true);
    expect(e.contains(3, 3)).toBe(false);
  });

  it("contract shrinks by the radius", () => {
    const c = Selection.fromRect(20, 20, Rect.make(5, 5, 5, 5)).contract(1);
    expect(c.bbox).toEqual({ x: 6, y: 6, w: 3, h: 3 });
    expect(Selection.fromRect(20, 20, Rect.make(5, 5, 2, 2)).contract(5).isEmpty).toBe(true);
  });
});

describe("mask exports", () => {
  it("toMaskPng uses the OpenAI convention: alpha 0 inside the selection", () => {
    const s = Selection.fromRect(4, 4, Rect.make(0, 0, 2, 2));
    const m = s.toMaskPng();
    expect(m.getPixel(0, 0).a).toBe(0);
    expect(m.getPixel(3, 3).a).toBe(255);
    expect(m.getPixel(0, 0).r).toBe(0);
    const soft = new Selection(1, 1, new Uint8Array([100]));
    expect(soft.toMaskPng().getPixel(0, 0).a).toBe(155);
  });

  it("toLuminanceMask is opaque white inside / black outside", () => {
    const s = Selection.fromRect(4, 4, Rect.make(0, 0, 2, 2));
    const l = s.toLuminanceMask();
    expect(l.getPixel(1, 1)).toEqual(rgba(255, 255, 255, 255));
    expect(l.getPixel(3, 3)).toEqual(rgba(0, 0, 0, 255));
  });

  it("fromLayerAlpha copies alpha and honours offset", () => {
    const r = new Raster(2, 2);
    r.setPixel(0, 0, rgba(0, 0, 0, 200));
    r.setPixel(1, 1, rgba(0, 0, 0, 255));
    const s = Selection.fromLayerAlpha(r);
    expect(s.get(0, 0)).toBe(200);
    expect(s.get(1, 0)).toBe(0);
    const placed = Selection.fromLayerAlpha(r, { size: { w: 5, h: 5 }, offset: { x: 3, y: 3 } });
    expect(placed.get(3, 3)).toBe(200);
    expect(placed.get(4, 4)).toBe(255);
    expect(placed.bbox).toEqual({ x: 3, y: 3, w: 2, h: 2 });
  });

  it("resized keeps a full selection full", () => {
    expect(Selection.all(4, 4).resized(8, 6).isAll).toBe(true);
  });
});
