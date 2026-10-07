import { describe, expect, it } from "vitest";
import { Raster, Rect, StyleCache, addLayer, bindDocStyleCache, compositeToRaster, createDocument, createRasterLayer, defaultDropShadow, docStyleCache, rgba } from "../../lib/engine";

function styledDoc() {
  const doc = createDocument({ width: 40, height: 40, background: "white" });
  const r = new Raster(40, 40);
  r.fill(rgba(255, 0, 0), Rect.make(10, 10, 10, 10));
  const layer = createRasterLayer(doc, { name: "Red", raster: r });
  layer.effects = { dropShadow: { ...defaultDropShadow(), enabled: true } };
  addLayer(doc, layer);
  return { doc, layer };
}

describe("shared per-document style cache", () => {
  it("is unbound until a compositor binds one", () => {
    const { doc } = styledDoc();
    expect(docStyleCache(doc)).toBeUndefined();
    const cache = new StyleCache();
    bindDocStyleCache(doc, cache);
    expect(docStyleCache(doc)).toBe(cache);
  });

  it("compositeToRaster reuses the bound cache and matches an uncached composite", () => {
    const { doc, layer } = styledDoc();
    const fresh = compositeToRaster(doc, { cache: new StyleCache() });
    const cache = new StyleCache();
    bindDocStyleCache(doc, cache);
    const viaShared = compositeToRaster(doc);
    expect(Array.from(viaShared.data)).toEqual(Array.from(fresh.data));
    // The styled source now lives in the shared cache (a second call hits it).
    const hit = cache.styledSource(doc, layer);
    expect(hit?.styled).toBe(true);
    expect(cache.styledSource(doc, layer)?.raster).toBe(hit?.raster);
  });

  it("invalidate() on the shared cache picks up in-place pixel edits", () => {
    const { doc, layer } = styledDoc();
    const cache = new StyleCache();
    bindDocStyleCache(doc, cache);
    compositeToRaster(doc);
    if (layer.kind !== "raster") throw new Error("raster expected");
    layer.raster.fill(rgba(0, 255, 0), Rect.make(10, 10, 10, 10));
    cache.invalidate(layer.id);
    const after = compositeToRaster(doc);
    const p = after.getPixel(15, 15);
    expect([p.r, p.g, p.b]).toEqual([0, 255, 0]);
  });
});
