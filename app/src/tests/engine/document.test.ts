import { describe, expect, it } from "vitest";
import {
  BlendMode,
  Raster,
  Rect,
  Selection,
  addLayer,
  childrenOf,
  compositeSelectionBbox,
  compositeToRaster,
  createDocument,
  createRasterLayer,
  duplicateLayer,
  flatten,
  getRasterLayer,
  groupLayers,
  layerBlock,
  layerIndex,
  mergeDown,
  mergeVisible,
  moveLayer,
  removeLayer,
  renameLayer,
  rgba,
  setLayerProps,
  topLevelLayers,
  ungroupLayers,
} from "../../lib/engine";

describe("createDocument", () => {
  it("creates a background layer and selection of the right size", () => {
    const doc = createDocument({ width: 8, height: 6, background: "white" });
    expect(doc.layers).toHaveLength(1);
    expect(doc.activeLayerId).toBe(doc.layers[0]!.id);
    expect(getRasterLayer(doc, doc.activeLayerId!).raster.getPixel(0, 0)).toEqual(rgba(255, 255, 255, 255));
    expect(doc.selection.width).toBe(8);
    expect(doc.selection.isEmpty).toBe(true);
    expect(doc.dirty).toBe(false);
  });

  it("rejects invalid sizes", () => {
    expect(() => createDocument({ width: 0, height: 10 })).toThrow();
    expect(() => createDocument({ width: 9000, height: 10 })).toThrow();
  });
});

describe("layer stack ops", () => {
  it("add / remove / duplicate / move / rename", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const bg = doc.layers[0]!;
    const l2 = createRasterLayer(doc, { name: "Two" });
    addLayer(doc, l2);
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "Two"]);
    expect(doc.activeLayerId).toBe(l2.id);
    expect(doc.dirty).toBe(true);

    const copies = duplicateLayer(doc, l2.id);
    expect(copies[0]!.name).toBe("Two copy");
    expect(copies[0]!.raster).not.toBe(l2.raster);
    expect(doc.layers).toHaveLength(3);

    moveLayer(doc, copies[0]!.id, 0);
    expect(doc.layers[0]!.id).toBe(copies[0]!.id);
    expect(layerIndex(doc, bg.id)).toBe(1);

    renameLayer(doc, bg.id, "Base");
    expect(bg.name).toBe("Base");

    removeLayer(doc, copies[0]!.id);
    expect(doc.layers.map((l) => l.name)).toEqual(["Base", "Two"]);
  });

  it("setLayerProps reports only the keys that changed and clamps opacity", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const id = doc.layers[0]!.id;
    const prev = setLayerProps(doc, id, { opacity: 2, visible: true, name: "Background" });
    expect(prev).toEqual({ opacity: 1 });
    expect(doc.layers[0]!.opacity).toBe(1);
    const prev2 = setLayerProps(doc, id, { opacity: 0.25, blendMode: BlendMode.Screen });
    expect(prev2).toEqual({ opacity: 1, blendMode: BlendMode.Normal });
  });

  it("groups keep children contiguous after the group entry", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const a = createRasterLayer(doc, { name: "A" });
    const b = createRasterLayer(doc, { name: "B" });
    addLayer(doc, a);
    addLayer(doc, b);
    const g = groupLayers(doc, [a.id, b.id], "G");
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "G", "A", "B"]);
    expect(childrenOf(doc, g.id).map((l) => l.name)).toEqual(["A", "B"]);
    expect(topLevelLayers(doc).map((l) => l.name)).toEqual(["Background", "G"]);
    expect(layerBlock(doc, g.id)).toEqual({ start: 1, end: 4 });
    removeLayer(doc, g.id);
    expect(doc.layers).toHaveLength(1);
    const doc2 = createDocument({ width: 4, height: 4 });
    const c = createRasterLayer(doc2, { name: "C" });
    addLayer(doc2, c);
    const g2 = groupLayers(doc2, [c.id]);
    ungroupLayers(doc2, g2.id);
    expect(doc2.layers.map((l) => l.name)).toEqual(["Background", "C"]);
    expect(c.parentId).toBeNull();
  });
});

describe("compositeToRaster", () => {
  it("composites a 3-layer document to the expected pixels", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const gray = createRasterLayer(doc, { name: "gray", blendMode: BlendMode.Multiply });
    gray.raster.fill(rgba(128, 128, 128));
    addLayer(doc, gray);
    const red = createRasterLayer(doc, { name: "red", opacity: 0.5 });
    red.raster.fill(rgba(255, 0, 0));
    addLayer(doc, red);
    const out = compositeToRaster(doc);
    const p = out.getPixel(2, 2);
    expect(Math.abs(p.r - 192)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.g - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.b - 64)).toBeLessThanOrEqual(1);
    expect(p.a).toBe(255);
    // Hidden layer is skipped; ignoreVisibility brings it back.
    red.visible = false;
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(128, 128, 128, 255));
    expect(compositeToRaster(doc, { ignoreVisibility: true }).getPixel(0, 0).r).toBeGreaterThan(180);
  });

  it("honours layer offsets, partial rects and `into`", () => {
    const doc = createDocument({ width: 6, height: 6, noBackgroundLayer: true });
    const small = createRasterLayer(doc, { raster: Raster.filled(2, 2, rgba(0, 255, 0)), offset: { x: 3, y: 3 } });
    addLayer(doc, small);
    const out = compositeToRaster(doc);
    expect(out.getPixel(3, 3)).toEqual(rgba(0, 255, 0, 255));
    expect(out.getPixel(4, 4)).toEqual(rgba(0, 255, 0, 255));
    expect(out.getPixel(2, 2).a).toBe(0);
    expect(out.getPixel(5, 5).a).toBe(0);
    const into = Raster.filled(6, 6, rgba(9, 9, 9));
    compositeToRaster(doc, { rect: Rect.make(0, 0, 4, 4), into });
    expect(into.getPixel(3, 3)).toEqual(rgba(0, 255, 0, 255));
    expect(into.getPixel(0, 0).a).toBe(0);
    expect(into.getPixel(5, 5)).toEqual(rgba(9, 9, 9, 255)); // outside rect untouched
  });

  it("composites groups in isolation with group opacity and blend mode", () => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const red = createRasterLayer(doc, { name: "red", opacity: 0.5 });
    red.raster.fill(rgba(255, 0, 0));
    addLayer(doc, red);
    const g = groupLayers(doc, [red.id]);
    g.opacity = 0.5;
    const p = compositeToRaster(doc).getPixel(0, 0);
    expect(p.r).toBe(255);
    expect(Math.abs(p.g - 191)).toBeLessThanOrEqual(1);
    g.visible = false;
    expect(compositeToRaster(doc).getPixel(0, 0)).toEqual(rgba(255, 255, 255, 255));
  });

  it("applies a layer mask's red channel to alpha", () => {
    const doc = createDocument({ width: 2, height: 1, background: "white" });
    const red = createRasterLayer(doc, { name: "red" });
    red.raster.fill(rgba(255, 0, 0));
    red.mask = new Raster(2, 1);
    red.mask.setPixel(0, 0, rgba(255, 255, 255));
    red.mask.setPixel(1, 0, rgba(0, 0, 0));
    addLayer(doc, red);
    const out = compositeToRaster(doc);
    expect(out.getPixel(0, 0)).toEqual(rgba(255, 0, 0, 255));
    expect(out.getPixel(1, 0)).toEqual(rgba(255, 255, 255, 255));
  });

  it("compositeSelectionBbox crops to the selection", () => {
    const doc = createDocument({ width: 10, height: 10, background: "white" });
    expect(compositeSelectionBbox(doc)).toBeNull();
    doc.selection = Selection.fromRect(10, 10, Rect.make(2, 3, 4, 2));
    const r = compositeSelectionBbox(doc, 1);
    expect(r?.rect).toEqual({ x: 1, y: 2, w: 6, h: 4 });
    expect(r?.raster.width).toBe(6);
  });
});

describe("merge / flatten", () => {
  it("mergeDown keeps the lower layer and composites the upper into it", () => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const bg = doc.layers[0]!;
    const red = createRasterLayer(doc, { name: "red", opacity: 0.5 });
    red.raster.fill(rgba(255, 0, 0));
    addLayer(doc, red);
    const merged = mergeDown(doc, red.id);
    expect(merged.id).toBe(bg.id);
    expect(doc.layers).toHaveLength(1);
    expect(Math.abs(merged.raster.getPixel(0, 0).g - 128)).toBeLessThanOrEqual(1);
    expect(() => mergeDown(doc, bg.id)).toThrow();
  });

  it("mergeVisible leaves hidden layers alone; flatten collapses everything", () => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const hidden = createRasterLayer(doc, { name: "hidden", visible: false });
    addLayer(doc, hidden);
    const top = createRasterLayer(doc, { name: "top" });
    top.raster.fill(rgba(0, 0, 255));
    addLayer(doc, top);
    mergeVisible(doc);
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "hidden"]);
    expect(getRasterLayer(doc, doc.layers[0]!.id).raster.getPixel(0, 0)).toEqual(rgba(0, 0, 255, 255));
    const flat = flatten(doc);
    expect(doc.layers).toEqual([flat]);
    expect(flat.raster.getPixel(1, 1)).toEqual(rgba(0, 0, 255, 255));
  });
});
