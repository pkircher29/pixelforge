import { expect, it } from "vitest";
import { Raster, Rect, TiledRaster, rgba } from "../../lib/engine";
import { findCoveredHealSource, findHealSource, healCoveredRegion, healRegion, ringMask } from "../../lib/tools/heal";

it("matches full healing at interior and image edges without expanding tiled layers", () => {
  for (const origin of [{ x: 250, y: 250 }, { x: 0, y: 0 }, { x: 516, y: 260 }]) {
    const source = new Raster(530, 270);
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      source.setPixel(x, y, rgba((x * 13 + y * 3) % 256, (y * 11) % 256, (x * 7) % 256, x % 17 === 0 ? 0 : 255));
    }
    const sparseSource = TiledRaster.fromBytes(source.width, source.height, source.data);
    for (const mode of ["normal", "replace"] as const) for (const offset of [{ x: 20, y: -8 }, { x: -12, y: 9 }]) {
      const dense = source.clone(), tiled = sparseSource.clone();
      const bounds = Rect.intersect(Rect.make(origin.x, origin.y, 14, 10), source.bounds());
      const coverage = (x: number, y: number) => x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.w && y < bounds.y + bounds.h ? 0.7 : 0;
      const mask = new Float32Array(source.width * source.height);
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) mask[y * source.width + x] = coverage(x, y);
      const full = healRegion(dense, source, mask, offset, { mode });
      const bounded = healCoveredRegion(tiled, sparseSource, bounds, coverage, offset, { mode });
      expect(bounded).toEqual(full);
      const bytes = tiled.readPixels(tiled.bounds());
      expect(bytes.findIndex((value, i) => value !== dense.data[i])).toBe(-1);
      expect(tiled.storageMode).toBe("tiled");
      expect(sparseSource.storageMode).toBe("tiled");
    }
  }
});

it("matches automatic source search near image and tile edges without materializing the source", () => {
  const dense = new Raster(530, 270);
  for (let y = 0; y < 270; y++) for (let x = 0; x < 530; x++) dense.setPixel(x, y, rgba((x * 7 + y * 3) % 256, (y * 11) % 256, (x * 5) % 256));
  const sparse = TiledRaster.fromBytes(530, 270, dense.data);
  for (const bounds of [Rect.make(250, 240, 14, 10), Rect.make(0, 0, 14, 10), Rect.make(515, 259, 14, 10)]) {
    const mask = new Float32Array(530 * 270);
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) for (let x = bounds.x; x < bounds.x + bounds.w; x++) mask[y * 530 + x] = 1;
    const ring = ringMask(mask, 530, 270, bounds, 3);
    for (const opts of [{}, { radii: [15.4] }]) {
      expect(findCoveredHealSource(sparse, bounds, (x, y) => mask[y * 530 + x] ?? 0, opts)).toEqual(findHealSource(dense, mask, bounds, ring, opts));
      expect(sparse.storageMode).toBe("tiled");
    }
  }
});

it("heals a small area on a 4000 by 3000 sparse layer without allocating full layer buffers", () => {
  const source = new TiledRaster(4000, 3000);
  source.fill(rgba(100, 120, 140), Rect.make(1800, 1400, 400, 200));
  const dst = source.clone();
  dst.fill(rgba(30, 40, 50), Rect.make(1995, 1495, 10, 10));
  const bounds = Rect.make(1995, 1495, 10, 10);
  const coverage = (x: number, y: number) => Rect.containsPoint(bounds, x, y) ? 1 : 0;
  const before = dst.byteLength();
  const offset = findCoveredHealSource(source, bounds, coverage);
  expect(healCoveredRegion(dst, source, bounds, coverage, offset)).not.toBeNull();
  expect(dst.storageMode).toBe("tiled");
  expect(source.storageMode).toBe("tiled");
  expect(dst.getPixel(2000, 1500)).toEqual(rgba(100, 120, 140));
  expect(dst.byteLength()).toBeLessThanOrEqual(before + 4 * 256 * 256 * 4);
});
