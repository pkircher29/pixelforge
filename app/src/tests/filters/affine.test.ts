import { describe, expect, it } from "vitest";
import { Raster, Rect, rgba } from "../../lib/engine";
import { Mat, affineResample, transformedBounds } from "../../lib/filters/transform/affine";
import { transformMatrix, isIdentityParams, IDENTITY_PARAMS } from "../../lib/filters/transform/session.svelte";

function checker(w: number, h: number): Raster {
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.setPixel(x, y, rgba(x * 40, y * 40, (x + y) * 20, 255));
  return r;
}

describe("Mat", () => {
  it("multiplies, inverts and applies", () => {
    const m = Mat.chain(Mat.scale(2, 3), Mat.rotate(Math.PI / 2), Mat.translate(5, 7));
    const p = Mat.apply(m, { x: 1, y: 1 });
    // scale -> (2,3); rotate 90 cw (y down) -> (-3, 2); translate -> (2, 9)
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(9, 9);
    const back = Mat.apply(Mat.invert(m), p);
    expect(back.x).toBeCloseTo(1, 9);
    expect(back.y).toBeCloseTo(1, 9);
    expect(Mat.isIdentity(Mat.mul(m, Mat.invert(m)))).toBe(true);
    expect(() => Mat.invert([0, 0, 0, 0, 1, 1])).toThrow();
    expect(Mat.toCss(Mat.translate(1.5, -2))).toBe("matrix(1, 0, 0, 1, 1.5, -2)");
  });

  it("transformedBounds snaps float dust and rounds out", () => {
    expect(transformedBounds(4, 4, Mat.identity())).toEqual(Rect.ofSize(4, 4));
    const r = transformedBounds(4, 4, Mat.chain(Mat.translate(-2, -2), Mat.rotate(Math.PI / 2), Mat.translate(2, 2)));
    expect(r).toEqual(Rect.ofSize(4, 4));
    expect(transformedBounds(10, 10, Mat.translate(0.25, -0.5))).toEqual({ x: 0, y: -1, w: 11, h: 11 });
  });
});

describe("affineResample", () => {
  it("identity is exact", () => {
    const src = checker(5, 4);
    const out = affineResample(src, Mat.identity(), src.bounds());
    expect(out.equals(src)).toBe(true);
    expect(affineResample(src, Mat.identity(), src.bounds(), "nearest").equals(src)).toBe(true);
  });

  it("integer translation is exact and outside pixels are transparent", () => {
    const src = checker(4, 4);
    const out = affineResample(src, Mat.translate(2, 1), Rect.ofSize(6, 5));
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        const inside = x >= 2 && y >= 1;
        expect(out.getPixel(x, y)).toEqual(inside ? src.getPixel(x - 2, y - 1) : { r: 0, g: 0, b: 0, a: 0 });
      }
    }
    // Output rect offset: the same picture, cropped.
    const part = affineResample(src, Mat.translate(2, 1), Rect.make(2, 1, 4, 4));
    expect(part.equals(src)).toBe(true);
  });

  it("90° rotation about the centre matches Raster.rotate90 exactly", () => {
    const src = checker(6, 4);
    const m = Mat.chain(Mat.translate(-3, -2), Mat.rotate(Math.PI / 2), Mat.translate(2, 3));
    const bounds = transformedBounds(6, 4, m);
    expect(bounds).toEqual(Rect.ofSize(4, 6));
    const out = affineResample(src, m, bounds);
    expect(out.equals(src.rotate90(true))).toBe(true);
    const ccw = Mat.chain(Mat.translate(-3, -2), Mat.rotate(-Math.PI / 2), Mat.translate(2, 3));
    expect(affineResample(src, ccw, bounds).equals(src.rotate90(false))).toBe(true);
  });

  it("flip via negative scale matches flipH", () => {
    const src = checker(5, 3);
    const m = Mat.chain(Mat.translate(-2.5, 0), Mat.scale(-1, 1), Mat.translate(2.5, 0));
    expect(affineResample(src, m, src.bounds()).equals(src.flipH())).toBe(true);
  });

  it("2x scale with nearest replicates pixels; bilinear interpolates between them", () => {
    const src = new Raster(2, 1);
    src.setPixel(0, 0, rgba(0, 0, 0));
    src.setPixel(1, 0, rgba(200, 200, 200));
    const near = affineResample(src, Mat.scale(2, 1), Rect.ofSize(4, 1), "nearest");
    expect([0, 1, 2, 3].map((x) => near.getPixel(x, 0).r)).toEqual([0, 0, 200, 200]);
    const bil = affineResample(src, Mat.scale(2, 1), Rect.ofSize(4, 1));
    const vals = [0, 1, 2, 3].map((x) => bil.getPixel(x, 0).r);
    expect(vals[0]).toBe(0);
    expect(vals[3]).toBe(200);
    expect(vals[1]).toBeGreaterThan(0);
    expect(vals[1]).toBeLessThan(vals[2]!);
    expect(vals[2]).toBeLessThan(200);
  });

  it("does not darken edges of a partially transparent raster", () => {
    const src = new Raster(3, 1);
    src.setPixel(1, 0, rgba(255, 255, 255, 255));
    const out = affineResample(src, Mat.translate(0.5, 0), Rect.ofSize(4, 1));
    for (let x = 0; x < 4; x++) {
      const p = out.getPixel(x, 0);
      if (p.a > 0) expect(p.r).toBe(255);
    }
    expect(out.getPixel(1, 0).a).toBe(128);
    expect(out.getPixel(2, 0).a).toBe(128);
  });
});

describe("transform session matrix", () => {
  it("identity params produce the layer's own placement", () => {
    const m = transformMatrix(10, 6, { x: 3, y: 4 }, IDENTITY_PARAMS);
    expect(Mat.apply(m, { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
    expect(Mat.apply(m, { x: 10, y: 6 })).toEqual({ x: 13, y: 10 });
    expect(isIdentityParams(IDENTITY_PARAMS)).toBe(true);
    expect(isIdentityParams({ ...IDENTITY_PARAMS, angle: 10 })).toBe(false);
  });

  it("scales and rotates about the centre, then translates", () => {
    const m = transformMatrix(10, 6, { x: 0, y: 0 }, { tx: 2, ty: 0, sx: 2, sy: 1, angle: 180 });
    const c = Mat.apply(m, { x: 5, y: 3 });
    expect(c.x).toBeCloseTo(7, 9);
    expect(c.y).toBeCloseTo(3, 9);
    const tl = Mat.apply(m, { x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(17, 9);
    expect(tl.y).toBeCloseTo(6, 9);
  });
});
