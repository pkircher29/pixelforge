import { expect, it } from "vitest";
import { AddGenerativeLayerCommand, SelectGenerativeVariantCommand, History, Raster, createDocument, createRasterLayer,
  duplicateLayer, generativeVariants, generativeFromFile, compositeToRaster, rgba } from "../../lib/engine";
import { documentFromProjectFrame, projectFrameParts, type ProjectHeader } from "../../lib/io/convert";
import { decodeFrame, encodeFrame } from "../../lib/io/frame";

it("switches editable variants, undoes, duplicates independently and survives project frames", () => {
  const doc = createDocument({ width: 4, height: 4, noBackgroundLayer: true });
  const variants = [10, 80, 150].map((r) => createRasterLayer(doc, { raster: Raster.filled(4, 4, rgba(r, 20, 30)) }));
  const history = new History(doc);
  const add = new AddGenerativeLayerCommand(doc, variants, { prompt: "red cube", provider: "Fixture", model: "fixture" });
  history.push(add);
  expect(compositeToRaster(doc).getPixel(0, 0).r).toBe(10);
  history.push(new SelectGenerativeVariantCommand(add.group.id, variants[1]!.id));
  expect(compositeToRaster(doc).getPixel(0, 0).r).toBe(80);
  history.undo();
  expect(compositeToRaster(doc).getPixel(0, 0).r).toBe(10);
  history.redo();
  variants[1]!.raster.setPixel(0, 0, rgba(99, 88, 77));
  history.push(new SelectGenerativeVariantCommand(add.group.id, variants[2]!.id));
  history.push(new SelectGenerativeVariantCommand(add.group.id, variants[1]!.id));
  expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(99, 88, 77));
  const copies = duplicateLayer(doc, add.group.id);
  const copy = copies[0]!;
  if (copy.kind !== "group") throw new Error("Expected group");
  expect(generativeVariants(doc, copy)).toHaveLength(3);
  expect(copy.generative!.variantIds.some((id) => add.group.generative!.variantIds.includes(id))).toBe(false);
  generativeVariants(doc, copy)[1]!.raster.setPixel(0, 0, rgba(1, 2, 3));
  expect(variants[1]!.raster.getPixel(0, 0)).toEqual(rgba(99, 88, 77));
  const parts = projectFrameParts(doc, "variants.pfproj", "test", null);
  const saved = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(parts.header as unknown as Record<string, unknown>, parts.blobs)));
  const restored = saved.layers.find((l) => l.id === add.group.id)!;
  if (restored.kind !== "group") throw new Error("Expected restored group");
  expect(restored.generative).toEqual(add.group.generative);
  const savedVariants = generativeVariants(saved, restored);
  expect(savedVariants.map((l) => l.visible)).toEqual([false, true, false]);
  expect(savedVariants[1]!.raster.getPixel(0, 0)).toEqual(rgba(99, 88, 77));
});

it("adds all three variants in a single undo step and rejects foreign variant IDs", () => {
  const doc = createDocument({ width: 2, height: 2 });
  const before = doc.layers.length;
  const history = new History(doc);
  const add = new AddGenerativeLayerCommand(doc, [1, 2, 3].map(() => createRasterLayer(doc)), { prompt: "p", provider: "p", model: "m" });
  history.push(add);
  expect(doc.layers).toHaveLength(before + 4);
  expect(() => new SelectGenerativeVariantCommand(add.group.id, doc.layers[0]!.id).do(doc)).toThrow();
  history.undo();
  expect(doc.layers).toHaveLength(before);
  history.redo();
  expect(generativeVariants(doc, add.group)).toHaveLength(3);
  expect(generativeFromFile({ prompt: "p", provider: "p", model: "m", variantIds: ["x", "x"] })).toBeUndefined();
});
