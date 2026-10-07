import { expect, it } from "vitest";
import { Raster, Rect, TiledRaster, rgba } from "../../lib/engine";

it("allocates only populated tiles, including hidden RGB, and releases cleared tiles", () => {
  const raster = new TiledRaster(4000, 3000);
  expect(raster.byteLength()).toBe(0);
  raster.setPixel(0, 0, rgba(0, 0, 0, 0));
  expect(raster.allocatedTileCount).toBe(0);
  raster.setPixel(255, 255, rgba(255, 0, 0));
  raster.setPixel(256, 256, rgba(2, 3, 4, 0));
  expect(raster.allocatedTileCount).toBe(2);
  expect(raster.boundingBoxOfAlpha()).toEqual(Rect.make(255, 255, 1, 1));
  expect(raster.getPixel(256, 256)).toEqual(rgba(2, 3, 4, 0));
  raster.setPixel(255, 255, rgba(0, 0, 0, 0));
  expect(raster.allocatedTileCount).toBe(1);
  raster.clear();
  expect(raster.byteLength()).toBe(0);
  expect(raster.storageMode).toBe("tiled");
});

it("shares immutable tiles between snapshots and detaches only the touched tile", () => {
  const raster = new TiledRaster(1024, 1024);
  raster.setPixel(1, 1, rgba(20, 30, 40));
  raster.setPixel(600, 700, rgba(50, 60, 70));
  const copy = raster.clone();
  expect(TiledRaster.retainedPixelBytes([raster, copy])).toBe(2 * 256 * 256 * 4);
  copy.setPixel(1, 1, rgba(255, 0, 0));
  expect(TiledRaster.retainedPixelBytes([raster, copy])).toBe(3 * 256 * 256 * 4);
  expect(raster.getPixel(1, 1)).toEqual(rgba(20, 30, 40));
  raster.clear(Rect.make(600, 700, 1, 1));
  expect(copy.getPixel(600, 700)).toEqual(rgba(50, 60, 70));
  const upload = copy.readTile(0, 0)!; upload.fill(0);
  expect(copy.getPixel(1, 1)).toEqual(rgba(255, 0, 0));
});

it("matches contiguous pixels for clipped fills, edge tiles, crops and alpha bounds", () => {
  const dense = new Raster(517, 269), tiled = new TiledRaster(517, 269);
  for (const raster of [dense, tiled]) {
    raster.fill(rgba(100, 20, 7, 130), Rect.make(250, 252, 30, 30));
    raster.fill(rgba(5, 6, 7), Rect.make(511, 260, 20, 20));
    raster.clear(Rect.make(254, 254, 3, 3));
    raster.setPixel(-1, 0, rgba(255, 255, 255));
  }
  expect(tiled.boundingBoxOfAlpha()).toEqual(dense.boundingBoxOfAlpha());
  expect(tiled.boundingBoxOfAlpha(-1)).toEqual(dense.boundingBoxOfAlpha(-1));
  expect(tiled.boundingBoxOfAlpha(NaN)).toBeNull();
  for (const rect of [Rect.make(240, 245, 80, 40), Rect.make(-5, -7, 530, 290)]) {
    const crop = tiled.crop(rect);
    expect(crop.storageMode).toBe("tiled");
    expect(crop.data).toEqual(dense.crop(rect).data);
  }
  expect(tiled.storageMode).toBe("tiled");
  expect(tiled.data).toEqual(dense.data);
  expect(tiled.storageMode).toBe("contiguous");
  expect(tiled.allocatedTileCount).toBe(0);
});

it("keeps the legacy writable array live without changing older sparse snapshots", () => {
  const raster = new TiledRaster(300, 270);
  raster.setPixel(299, 269, rgba(1, 2, 3));
  const snapshot = raster.clone();
  const data = raster.data;
  data.set([10, 20, 30, 40], (269 * 300 + 299) * 4);
  expect(raster.data).toBe(data);
  expect(raster.getPixel(299, 269)).toEqual(rgba(10, 20, 30, 40));
  expect(snapshot.getPixel(299, 269)).toEqual(rgba(1, 2, 3));
  raster.setPixel(0, 0, rgba(4, 5, 6));
  expect(data.subarray(0, 4)).toEqual(new Uint8ClampedArray([4, 5, 6, 255]));
  expect(raster.clone().data).not.toBe(data);
  expect(snapshot.storageMode).toBe("tiled");
});

it("retains touched tile versions rather than full canvases for 200 snapshots", () => {
  const layers = Array.from({ length: 30 }, () => new TiledRaster(4000, 3000));
  const snapshots: TiledRaster[] = [];
  for (let i = 0; i < 200; i++) {
    const layer = layers[i % layers.length]!;
    snapshots.push(layer.clone());
    layer.setPixel(10, 10, rgba(i, 30, 60));
  }
  expect(TiledRaster.retainedPixelBytes([...layers, ...snapshots])).toBe(200 * 256 * 256 * 4);
  expect(layers.every(layer => layer.storageMode === "tiled")).toBe(true);
  expect(snapshots[30]!.getPixel(10, 10)).toEqual(rgba(0, 30, 60));
});
