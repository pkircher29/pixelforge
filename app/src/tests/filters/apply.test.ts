import { describe, expect, it } from "vitest";
import { Raster, Rect, Selection, rgba } from "../../lib/engine";
import { affectedRect, applyOp } from "../../lib/filters/apply";
import { GpuOp } from "../../lib/filters/gpu";
import { gaussianBlur, invert } from "../../lib/filters/ops";

function gradient(w: number, h: number): Raster {
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.setPixel(x, y, rgba((x * 255) / (w - 1), (y * 255) / (h - 1), 100, 255));
  return r;
}

describe("applyOp + selection masking", () => {
  it("falls back to the CPU in jsdom (no WebGL2)", () => {
    expect(GpuOp.isAvailable()).toBe(false);
    const res = applyOp(invert, gradient(4, 4), {});
    expect(res.backend).toBe("cpu");
  });

  it("without a selection returns the whole raster", () => {
    const src = gradient(6, 5);
    const res = applyOp(invert, src, {}, null);
    expect(res.dirtyRect).toEqual(Rect.ofSize(6, 5));
    expect(res.raster.equals(invert.cpu(src, {}))).toBe(true);
    // Empty selection behaves like "no selection".
    const res2 = applyOp(invert, src, {}, Selection.none(6, 5));
    expect(res2.dirtyRect).toEqual(Rect.ofSize(6, 5));
  });

  it("only touches selected pixels and reports the selection bbox as dirty rect", () => {
    const src = gradient(10, 10);
    const sel = Selection.fromRect(10, 10, Rect.make(2, 3, 4, 3));
    const res = applyOp(invert, src, {}, sel);
    expect(res.dirtyRect).toEqual({ x: 2, y: 3, w: 4, h: 3 });
    expect(res.raster.width).toBe(4);
    expect(res.raster.height).toBe(3);
    const full = invert.cpu(src, {});
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(res.raster.getPixel(x, y)).toEqual(full.getPixel(x + 2, y + 3));
      }
    }
    // Blitting back leaves everything outside the rect untouched.
    const layer = src.clone();
    layer.blit(res.raster, res.dirtyRect.x, res.dirtyRect.y, undefined, { mode: "replace" });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const inside = Rect.containsPoint(res.dirtyRect, x, y);
        expect(layer.getPixel(x, y)).toEqual(inside ? full.getPixel(x, y) : src.getPixel(x, y));
      }
    }
  });

  it("soft selection lerps by coverage (straight alpha)", () => {
    const src = Raster.filled(4, 1, rgba(0, 0, 0, 255));
    const mask = new Uint8Array([0, 64, 128, 255]);
    const sel = Selection.fromMask(4, 1, mask);
    const res = applyOp(invert, src, {}, sel);
    expect(res.dirtyRect).toEqual({ x: 1, y: 0, w: 3, h: 1 });
    expect(res.raster.getPixel(0, 0).r).toBe(64);
    expect(res.raster.getPixel(1, 0).r).toBe(128);
    expect(res.raster.getPixel(2, 0).r).toBe(255);
  });

  it("respects the layer offset when sampling the doc-space selection", () => {
    const src = gradient(4, 4);
    // Layer sits at doc (10, 10); selection covers doc (11..12, 10..13).
    const sel = Selection.fromRect(20, 20, Rect.make(11, 10, 2, 4));
    const res = applyOp(invert, src, {}, sel, { offset: { x: 10, y: 10 } });
    expect(res.dirtyRect).toEqual({ x: 1, y: 0, w: 2, h: 4 });
    expect(affectedRect(src, sel, { x: 10, y: 10 })).toEqual({ x: 1, y: 0, w: 2, h: 4 });
    // A selection entirely off the layer yields an empty result.
    const off = applyOp(invert, src, {}, Selection.fromRect(20, 20, Rect.make(0, 0, 5, 5)), { offset: { x: 10, y: 10 } });
    expect(Rect.isEmpty(off.dirtyRect)).toBe(true);
    expect(off.raster.width).toBe(0);
  });

  it("neighbourhood ops read context outside the selection (margin) so results match a full-raster run", () => {
    const src = gradient(24, 24);
    const sel = Selection.fromRect(24, 24, Rect.make(8, 8, 6, 6));
    const res = applyOp(gaussianBlur, src, { radius: 2 }, sel);
    const full = gaussianBlur.cpu(src, { radius: 2 });
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const a = res.raster.getPixel(x, y);
        const b = full.getPixel(x + 8, y + 8);
        expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(1);
      }
    }
  });
});
