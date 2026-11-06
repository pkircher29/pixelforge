import { expect, it } from "vitest";
import { Raster, TiledRaster, Rect, createDocument, rgba } from "../lib/engine";
import { documentFromOpenFrame, documentFromProjectFrame, projectFrameParts, type OpenHeader, type ProjectHeader } from "../lib/io/convert";
import { decodeFrame, encodeFrame } from "../lib/io/frame";

it("captures project pixels without expanding live storage and reopens sparse edge tiles", () => {
  const doc = createDocument({ width: 530, height: 270, background: "transparent" });
  const layer = doc.layers[0]!;
  if (layer.kind !== "raster") throw new Error("Expected pixel layer");
  const pixels = layer.raster as TiledRaster;
  pixels.setPixel(529, 269, rgba(20, 30, 40, 90));
  pixels.setPixel(256, 256, rgba(7, 8, 9, 0));
  layer.offset = { x: -7, y: 4 };
  const mask = TiledRaster.filled(530, 270, rgba(255, 255, 255));
  mask.fill(rgba(75, 75, 75), Rect.make(528, 268, 2, 2));
  layer.mask = mask;
  const { header, blobs } = projectFrameParts(doc, "tiled.pfproj", "0.3.0", null);
  expect(pixels.storageMode).toBe("tiled");
  expect(mask.storageMode).toBe("tiled");
  // The queued save must keep the captured pixels while the live document changes.
  pixels.setPixel(529, 269, rgba(255, 0, 0));
  mask.clear();
  const saved = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(header as unknown as Record<string, unknown>, blobs)));
  const restored = saved.layers[0]!;
  if (restored.kind !== "raster") throw new Error("Expected restored pixel layer");
  expect(restored.offset).toEqual({ x: -7, y: 4 });
  expect(restored.raster).toBeInstanceOf(TiledRaster);
  expect((restored.raster as TiledRaster).allocatedTileCount).toBe(2);
  expect(restored.raster.getPixel(529, 269)).toEqual(rgba(20, 30, 40, 90));
  expect(restored.raster.getPixel(256, 256)).toEqual(rgba(7, 8, 9, 0));
  expect(restored.mask!.getPixel(529, 269)).toEqual(rgba(75, 75, 75));
});

it("loads image/PSD frame byte views into independent sparse layers", () => {
  const backing = new Uint8Array(9 + 520 * 260 * 4 + 5);
  backing.fill(123);
  const pixels = backing.subarray(9, 9 + 520 * 260 * 4);
  pixels.fill(0);
  pixels.set([1, 2, 3, 255], (259 * 520 + 519) * 4);
  const header: OpenHeader = { width: 520, height: 260, sourceFormat: "psd", blobs: [pixels.length], layers: [
    { name: "Offset layer", x: -2, y: 3, w: 520, h: 260, opacity: 1, visible: true, blendMode: "normal", isGroup: false, groupDepth: 0, group: null, blob: 0 },
  ] };
  const doc = documentFromOpenFrame({ header, blobs: [pixels] }, "Imported");
  const layer = doc.layers[0]!;
  if (layer.kind !== "raster") throw new Error("Expected pixel layer");
  expect(layer.raster).toBeInstanceOf(TiledRaster);
  expect((layer.raster as TiledRaster).allocatedTileCount).toBe(1);
  expect(layer.raster.byteLength()).toBe(8 * 4 * 4);
  expect(layer.offset).toEqual({ x: -2, y: 3 });
  pixels.fill(0);
  expect(layer.raster.getPixel(519, 259)).toEqual(rgba(1, 2, 3));
});

it("also detaches queued project pixels from a legacy contiguous layer", () => {
  const doc = createDocument({ width: 2, height: 2 });
  const layer = doc.layers[0]!;
  if (layer.kind !== "raster") throw new Error("Expected pixel layer");
  layer.raster = Raster.filled(2, 2, rgba(10, 20, 30));
  const { header, blobs } = projectFrameParts(doc, "legacy.pfproj", "0.3.0", null);
  layer.raster.fill(rgba(255, 0, 0));
  const restored = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(header as unknown as Record<string, unknown>, blobs)));
  expect(restored.layers[0]!.raster!.getPixel(0, 0)).toEqual(rgba(10, 20, 30));
});
