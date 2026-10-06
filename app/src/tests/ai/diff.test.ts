import { describe, expect, it } from "vitest";
import { Raster, rgba } from "../../lib/engine";
import { DIFF_THRESHOLD, diffRasters, pixelChanged } from "../../lib/ai/diff";

describe("diffRasters", () => {
  it("marks only pixels whose max channel delta exceeds the threshold", () => {
    const a = Raster.filled(4, 1, rgba(100, 100, 100));
    const b = a.clone();
    b.setPixel(1, 0, rgba(100 + DIFF_THRESHOLD, 100, 100)); // exactly at threshold: unchanged
    b.setPixel(2, 0, rgba(100, 100 + DIFF_THRESHOLD + 1, 100)); // just over: changed
    b.setPixel(3, 0, rgba(100, 100, 100, 0)); // alpha delta counts too
    const { overlay, changed, fraction } = diffRasters(a, b);
    expect(changed).toBe(2);
    expect(fraction).toBeCloseTo(0.5);
    expect(overlay.getPixel(0, 0).a).toBe(0);
    expect(overlay.getPixel(1, 0).a).toBe(0);
    expect(overlay.getPixel(2, 0)).toEqual(rgba(255, 0, 200, 160));
    expect(overlay.getPixel(3, 0).a).toBe(160);
  });

  it("honours custom threshold and colour", () => {
    const a = Raster.filled(2, 2, rgba(0, 0, 0));
    const b = Raster.filled(2, 2, rgba(10, 0, 0));
    expect(diffRasters(a, b).changed).toBe(0);
    const r = diffRasters(a, b, { threshold: 5, color: { r: 1, g: 2, b: 3 }, alpha: 99 });
    expect(r.changed).toBe(4);
    expect(r.overlay.getPixel(1, 1)).toEqual(rgba(1, 2, 3, 99));
  });

  it("identical rasters produce an empty overlay; mismatched sizes throw", () => {
    const a = Raster.filled(3, 3, rgba(5, 6, 7));
    expect(diffRasters(a, a.clone()).changed).toBe(0);
    expect(() => diffRasters(a, new Raster(2, 3))).toThrow(RangeError);
    expect(diffRasters(new Raster(0, 0), new Raster(0, 0)).fraction).toBe(0);
  });

  it("pixelChanged compares one pixel index", () => {
    const a = new Uint8ClampedArray([0, 0, 0, 255]);
    const b = new Uint8ClampedArray([0, 0, 30, 255]);
    expect(pixelChanged(a, b, 0, 24)).toBe(true);
    expect(pixelChanged(a, b, 0, 30)).toBe(false);
  });
});
