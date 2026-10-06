import { describe, expect, it } from "vitest";
import { Raster, Rect, rgba } from "../../lib/engine";

const RED = rgba(255, 0, 0);
const BLUE = rgba(0, 0, 255);

describe("Rect helpers", () => {
  it("intersects and reports empty", () => {
    const a = Rect.make(0, 0, 10, 10);
    const b = Rect.make(5, 5, 10, 10);
    expect(Rect.intersect(a, b)).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(Rect.isEmpty(Rect.intersect(a, Rect.make(20, 20, 2, 2)))).toBe(true);
    expect(Rect.isEmpty(null)).toBe(true);
    expect(Rect.isEmpty(a)).toBe(false);
  });

  it("unions, ignoring empty inputs", () => {
    const a = Rect.make(0, 0, 10, 10);
    const b = Rect.make(5, 5, 10, 10);
    expect(Rect.union(a, b)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(Rect.union(null, b)).toEqual(b);
    expect(Rect.union(a, Rect.empty())).toEqual(a);
  });

  it("clamps, rounds out and tests containment", () => {
    expect(Rect.clamp(Rect.make(-5, -5, 20, 20), Rect.ofSize(10, 10))).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(Rect.roundOut(Rect.make(0.5, 0.5, 1, 1))).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(Rect.containsPoint(Rect.ofSize(4, 4), 3, 3)).toBe(true);
    expect(Rect.containsPoint(Rect.ofSize(4, 4), 4, 3)).toBe(false);
    expect(Rect.contains(Rect.ofSize(10, 10), Rect.make(2, 2, 3, 3))).toBe(true);
    expect(Rect.area(Rect.make(1, 1, 3, 4))).toBe(12);
  });
});

describe("Raster basics", () => {
  it("clone is independent and fill/get/set work", () => {
    const r = new Raster(4, 4);
    r.fill(RED);
    const c = r.clone();
    c.setPixel(1, 1, BLUE);
    expect(r.getPixel(1, 1)).toEqual(RED);
    expect(c.getPixel(1, 1)).toEqual(BLUE);
    expect(r.getPixel(-1, 0)).toEqual(rgba(0, 0, 0, 0));
    expect(r.getPixel(4, 0).a).toBe(0);
    r.fill(BLUE, Rect.make(2, 2, 10, 10));
    expect(r.getPixel(1, 1)).toEqual(RED);
    expect(r.getPixel(3, 3)).toEqual(BLUE);
    expect(r.byteLength()).toBe(64);
  });

  it("rejects mismatched buffers", () => {
    expect(() => new Raster(2, 2, new Uint8ClampedArray(3))).toThrow();
    expect(() => new Raster(-1, 2)).toThrow();
  });

  it("toImageData exposes the same buffer", () => {
    const r = Raster.filled(2, 2, RED);
    const img = r.toImageData();
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.data[0]).toBe(255);
  });
});

describe("Raster.blit", () => {
  it("composites 50% blue over opaque red with straight-alpha over", () => {
    const dst = Raster.filled(1, 1, RED);
    const src = Raster.filled(1, 1, rgba(0, 0, 255, 128));
    dst.blit(src, 0, 0);
    const p = dst.getPixel(0, 0);
    expect(p.a).toBe(255);
    expect(Math.abs(p.r - 127)).toBeLessThanOrEqual(1);
    expect(p.g).toBe(0);
    expect(Math.abs(p.b - 128)).toBeLessThanOrEqual(1);
  });

  it("over a transparent destination copies the source exactly", () => {
    const dst = new Raster(1, 1);
    const src = Raster.filled(1, 1, rgba(10, 20, 30, 128));
    dst.blit(src, 0, 0);
    expect(dst.getPixel(0, 0)).toEqual(rgba(10, 20, 30, 128));
  });

  it("50% over 50% gives 75% alpha and the W3C colour", () => {
    const dst = Raster.filled(1, 1, rgba(0, 0, 0, 128));
    const src = Raster.filled(1, 1, rgba(255, 255, 255, 128));
    dst.blit(src, 0, 0);
    const p = dst.getPixel(0, 0);
    // as = ad = 0.502 -> ao = 0.752; co = 255 * 0.502 / 0.752 = 170
    expect(Math.abs(p.a - 192)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.r - 170)).toBeLessThanOrEqual(1);
  });

  it("replace mode with srcRect and clipping copies bytes", () => {
    const dst = new Raster(4, 4);
    const src = new Raster(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) src.setPixel(x, y, rgba(x * 10, y * 10, 0, 50));
    dst.blit(src, 3, 3, Rect.make(1, 1, 2, 2), { mode: "replace" });
    expect(dst.getPixel(3, 3)).toEqual(rgba(10, 10, 0, 50));
    expect(dst.getPixel(2, 2).a).toBe(0);
    // Negative offsets clip the source.
    const dst2 = new Raster(2, 2);
    dst2.blit(src, -2, -2, undefined, { mode: "replace" });
    expect(dst2.getPixel(0, 0)).toEqual(rgba(20, 20, 0, 50));
  });

  it("opacity scales source alpha", () => {
    const dst = new Raster(1, 1);
    dst.blit(Raster.filled(1, 1, RED), 0, 0, undefined, { opacity: 0.5 });
    expect(Math.abs(dst.getPixel(0, 0).a - 128)).toBeLessThanOrEqual(1);
  });
});

describe("Raster geometry ops", () => {
  it("crop pads out-of-range with transparent", () => {
    const r = Raster.filled(2, 2, RED);
    const c = r.crop(Rect.make(1, 1, 3, 3));
    expect(c.width).toBe(3);
    expect(c.getPixel(0, 0)).toEqual(RED);
    expect(c.getPixel(1, 1).a).toBe(0);
  });

  it("resize nearest doubles pixels", () => {
    const r = new Raster(2, 2);
    r.setPixel(0, 0, RED);
    r.setPixel(1, 0, BLUE);
    r.setPixel(0, 1, rgba(0, 255, 0));
    r.setPixel(1, 1, rgba(1, 2, 3));
    const big = r.resize(4, 4, "nearest");
    expect(big.getPixel(0, 0)).toEqual(RED);
    expect(big.getPixel(1, 1)).toEqual(RED);
    expect(big.getPixel(3, 0)).toEqual(BLUE);
    expect(big.getPixel(0, 3)).toEqual(rgba(0, 255, 0));
    expect(big.getPixel(3, 3)).toEqual(rgba(1, 2, 3));
  });

  it("resize bilinear interpolates the midpoint", () => {
    const r = new Raster(2, 1);
    r.setPixel(0, 0, rgba(0, 0, 0));
    r.setPixel(1, 0, rgba(255, 255, 255));
    const out = r.resize(3, 1, "bilinear");
    expect(out.getPixel(0, 0).r).toBe(0);
    expect(Math.abs(out.getPixel(1, 0).r - 128)).toBeLessThanOrEqual(1);
    expect(out.getPixel(2, 0).r).toBe(255);
  });

  it("resize bicubic preserves a constant image and same-size returns a copy", () => {
    const c = rgba(200, 100, 50);
    const r = Raster.filled(3, 3, c);
    const out = r.resize(7, 5, "bicubic");
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) expect(out.getPixel(x, y)).toEqual(c);
    const same = r.resize(3, 3, "bicubic");
    expect(same).not.toBe(r);
    expect(same.equals(r)).toBe(true);
  });

  it("flipH / flipV / rotate90 move pixels correctly", () => {
    const r = new Raster(2, 1);
    r.setPixel(0, 0, RED);
    r.setPixel(1, 0, BLUE);
    expect(r.flipH().getPixel(0, 0)).toEqual(BLUE);
    const v = new Raster(1, 2);
    v.setPixel(0, 0, RED);
    v.setPixel(0, 1, BLUE);
    expect(v.flipV().getPixel(0, 0)).toEqual(BLUE);
    const cw = r.rotate90(true);
    expect(cw.width).toBe(1);
    expect(cw.height).toBe(2);
    expect(cw.getPixel(0, 0)).toEqual(RED);
    expect(cw.getPixel(0, 1)).toEqual(BLUE);
    const ccw = r.rotate90(false);
    expect(ccw.getPixel(0, 0)).toEqual(BLUE);
    expect(ccw.getPixel(0, 1)).toEqual(RED);
  });

  it("boundingBoxOfAlpha finds the opaque region", () => {
    const r = new Raster(10, 10);
    expect(r.boundingBoxOfAlpha()).toBeNull();
    r.fill(RED, Rect.make(3, 4, 2, 5));
    expect(r.boundingBoxOfAlpha()).toEqual({ x: 3, y: 4, w: 2, h: 5 });
    r.setPixel(9, 0, rgba(0, 0, 0, 5));
    expect(r.boundingBoxOfAlpha(10)).toEqual({ x: 3, y: 4, w: 2, h: 5 });
    expect(r.boundingBoxOfAlpha(0)).toEqual({ x: 3, y: 0, w: 7, h: 9 });
  });
});
