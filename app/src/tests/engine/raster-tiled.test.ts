import { expect, it } from "vitest";
import { PaintCommand, Raster, Rect, TiledRaster, addLayer, compositeToRaster, createDocument, createRasterLayer, rgba } from "../../lib/engine";
import { sampleRaster } from "../../lib/ui/panels/thumbnail";

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

it("copies bounded regions without materializing source tiles", () => {
  const sparse = new TiledRaster(1000, 1000);
  sparse.fill(rgba(5, 10, 20, 128), Rect.make(254, 253, 8, 9));
  const region = Rect.make(250, 250, 20, 20);
  const bytes = sparse.readPixels(region);
  const dense = new Raster(20, 20);
  dense.blit(sparse, -250, -250, undefined, { mode: "replace" });
  expect(dense.data).toEqual(bytes);
  expect(sparse.storageMode).toBe("tiled");
  bytes.fill(0);
  expect(sparse.getPixel(255, 255).a).toBe(128);
  expect(sparse.readPixels(Rect.make(-3, -4, 10, 10))).toEqual(new Uint8ClampedArray(400));
});

it("matches contiguous over/replace blits with clipping, offsets and opacity", () => {
  const source = new Raster(280, 270);
  source.fill(rgba(30, 170, 80, 90), Rect.make(2, 4, 275, 260));
  source.fill(rgba(200, 50, 10, 230), Rect.make(254, 250, 26, 20));
  source.setPixel(0, 0, rgba(99, 88, 77, 0));
  const sparseSource = TiledRaster.fromBytes(source.width, source.height, source.data);
  for (const mode of ["over", "replace"] as const) for (const opacity of [0, 0.25, 1]) {
    const dense = Raster.filled(520, 280, rgba(90, 40, 160, 110));
    const tiled = TiledRaster.filled(520, 280, rgba(90, 40, 160, 110));
    const bounds = Rect.make(1, 2, 276, 267);
    dense.blit(source, 250, -8, bounds, { mode, opacity });
    tiled.blit(sparseSource, 250, -8, bounds, { mode, opacity });
    const actual = tiled.readPixels(tiled.bounds()), expected = dense.data;
    expect(actual.length).toBe(expected.length);
    expect(actual.findIndex((value, i) => value !== expected[i])).toBe(-1);
    expect(tiled.storageMode).toBe("tiled");
    expect(sparseSource.storageMode).toBe("tiled");
  }
});

it("handles overlapping self-copies, transparent replacement and snapshot isolation", () => {
  const sparse = new TiledRaster(600, 300);
  sparse.fill(rgba(255, 0, 0), Rect.make(250, 0, 15, 280));
  const snapshot = sparse.clone();
  const expected = Raster.fromBytes(600, 300, sparse.readPixels(sparse.bounds()));
  expected.blit(expected.clone(), 252, 5, Rect.make(250, 0, 15, 280), { mode: "replace" });
  sparse.blit(sparse, 252, 5, Rect.make(250, 0, 15, 280), { mode: "replace" });
  expect(sparse.readPixels(sparse.bounds())).toEqual(expected.data);
  expect(snapshot.getPixel(266, 6).a).toBe(0);
  sparse.blit(new TiledRaster(600, 300), 0, 0, undefined, { mode: "replace" });
  expect(sparse.allocatedTileCount).toBe(0);
  expect(snapshot.getPixel(250, 0).a).toBe(255);
});

it("uses sparse captures and restores sparse pixels through real paint commands", () => {
  const doc = createDocument({ width: 600, height: 300, background: "transparent" });
  const raster = new TiledRaster(600, 300);
  raster.setPixel(1, 1, rgba(50, 60, 70));
  const layer = createRasterLayer(doc, { raster });
  addLayer(doc, layer);
  const captured = PaintCommand.capture(layer);
  expect(captured.pixels).toBeInstanceOf(TiledRaster);
  expect(TiledRaster.retainedPixelBytes([raster, captured.pixels as TiledRaster])).toBe(256 * 256 * 4);
  const dirty = Rect.make(253, 254, 9, 8);
  raster.fill(rgba(255, 0, 0), dirty);
  const command = PaintCommand.finish(layer, captured, "Paint", dirty);
  command.undo(doc);
  expect(raster.getPixel(255, 255).a).toBe(0);
  command.do(doc);
  expect(raster.getPixel(255, 255)).toEqual(rgba(255, 0, 0));
  expect(raster.getPixel(1, 1)).toEqual(rgba(50, 60, 70));
  expect(raster.storageMode).toBe("tiled");
  expect(command.byteSize()).toBeLessThan(600 * 300 * 4);
});

it("keeps default layers sparse through CPU composition, clipping and thumbnails", () => {
  const doc = createDocument({ width: 520, height: 270, background: "transparent" });
  const base = doc.layers[0]!;
  if (base.kind !== "raster") throw new Error("Expected a pixel layer");
  expect(base.raster).toBeInstanceOf(TiledRaster);
  expect(base.raster.byteLength()).toBe(0);
  base.raster.fill(rgba(255, 0, 0), Rect.make(256, 256, 8, 8));
  const clipped = createRasterLayer(doc, { clipToBelow: true });
  clipped.raster.fill(rgba(0, 255, 0));
  addLayer(doc, clipped);
  expect(compositeToRaster(doc).getPixel(257, 257)).toEqual(rgba(0, 255, 0));
  const thumb = new Uint8ClampedArray(32 * 32 * 4);
  sampleRaster(base.raster, base.offset, Rect.make(256, 256, 8, 8), thumb, 32, 32);
  expect(thumb[0]).toBe(255);
  expect((base.raster as TiledRaster).storageMode).toBe("tiled");
  expect((clipped.raster as TiledRaster).storageMode).toBe("tiled");
  const tiny = TiledRaster.filled(2, 2, rgba(1, 2, 3));
  expect(tiny.byteLength()).toBe(16);
  expect(tiny.readTile(0, 0)?.length).toBe(16);
});
