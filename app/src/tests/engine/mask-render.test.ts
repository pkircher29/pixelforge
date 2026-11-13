import { describe, expect, it } from "vitest";
import { ApplyMaskCommand, History, Raster, SetLayerPropsCommand, addLayer, compositeToRaster, createAdjustmentLayer, createDocument, createFillLayer, createGroupLayer, createRasterLayer, getRasterLayer, rgba, solidFill } from "../../lib/engine";
import { renderMask } from "../../lib/engine/mask-render";
import { StyleCache } from "../../lib/engine/layer-source";

function hardMask(): Raster {
  const mask = Raster.filled(9, 3, rgba(0, 0, 0));
  for (let y = 0; y < 3; y++) for (let x = 4; x < 9; x++) mask.setPixel(x, y, rgba(255, 255, 255));
  return mask;
}

describe("non-destructive mask rendering", () => {
  it("feathers edges and reduces density without changing any source byte", () => {
    const mask = hardMask();
    const before = mask.clone();
    const blurred = renderMask(mask, 1, 1);
    expect(blurred.getPixel(3, 1).r).toBeGreaterThan(0);
    expect(blurred.getPixel(4, 1).r).toBeLessThan(255);
    expect(renderMask(mask, 0.5, 0).getPixel(0, 0).r).toBe(128);
    expect(renderMask(mask, 0, 2).getPixel(0, 0).r).toBe(255);
    expect(mask.equals(before)).toBe(true);
    expect(renderMask(mask, 1, 0)).toBe(mask);
  });

  it("updates cached masks and clip alpha after parameter changes and painting", () => {
    const doc = createDocument({ width: 9, height: 3, noBackgroundLayer: true });
    const layer = createRasterLayer(doc, { raster: Raster.filled(9, 3, rgba(255, 0, 0)), mask: hardMask() });
    const cache = new StyleCache();
    expect(cache.clipAlpha(doc, layer)[0]).toBe(0);
    layer.maskDensity = 0.5;
    expect(cache.clipAlpha(doc, layer)[0]).toBe(128);
    const mask = cache.mask(layer);
    expect(cache.mask(layer)).toBe(mask);
    layer.mask!.setPixel(0, 0, rgba(255, 255, 255));
    cache.invalidate(layer.id);
    expect(cache.mask(layer)!.getPixel(0, 0).r).toBe(255);
    layer.maskEnabled = false;
    expect(cache.mask(layer)).toBeNull();
    expect(cache.clipAlpha(doc, layer)[0]).toBe(255);
  });

  it("undo and Apply Mask preserve appearance while retaining the original mask for undo", () => {
    const doc = createDocument({ width: 9, height: 3, noBackgroundLayer: true });
    const layer = createRasterLayer(doc, { raster: Raster.filled(9, 3, rgba(255, 0, 0)), mask: hardMask() });
    addLayer(doc, layer);
    const source = layer.mask!;
    const bytes = source.clone();
    const h = new History(doc);
    h.push(new SetLayerPropsCommand(layer.id, { maskDensity: 0.5 }));
    h.push(new SetLayerPropsCommand(layer.id, { maskFeather: 1 }));
    const before = compositeToRaster(doc);
    h.push(new ApplyMaskCommand(layer.id));
    expect(layer.mask).toBeNull();
    expect(layer.maskDensity).toBe(1);
    expect(layer.maskFeather).toBe(0);
    expect(compositeToRaster(doc).equals(before)).toBe(true);
    h.undo();
    expect(layer.mask).toBe(source);
    expect(source.equals(bytes)).toBe(true);
    expect(layer.maskDensity).toBe(0.5);
    expect(layer.maskFeather).toBe(1);
    h.undo(); h.undo();
    expect(getRasterLayer(doc, layer.id).maskDensity).toBe(1);
    expect(compositeToRaster(doc).getPixel(0, 0).a).toBe(0);
  });

  it("applies density to fill and adjustment layers", () => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const fill = createFillLayer(doc, { fill: solidFill(rgba(255, 0, 0)), mask: Raster.filled(2, 2, rgba(0, 0, 0)), maskDensity: 0 });
    addLayer(doc, fill);
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(255, 0, 0));
    fill.maskDensity = 1;
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    const adj = createAdjustmentLayer(doc, { op: "invert", params: {}, mask: Raster.filled(2, 2, rgba(0, 0, 0)), maskDensity: 0 });
    addLayer(doc, adj);
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(0, 0, 0));
  });

  it.each([true, false])("applies density to groups (pass-through %s)", (passThrough) => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const group = createGroupLayer(doc, { passThrough, mask: Raster.filled(2, 2, rgba(0, 0, 0)), maskDensity: 0 });
    const child = createRasterLayer(doc, { parentId: group.id, raster: Raster.filled(2, 2, rgba(255, 0, 0)) });
    doc.layers.push(group, child);
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(255, 0, 0));
    group.maskDensity = 1;
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(255, 255, 255));
  });
});
