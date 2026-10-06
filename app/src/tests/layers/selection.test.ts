import { describe, expect, it } from "vitest";
import { selectOnClick, targetLayers, contextMenuState, canClip, canMergeDown, siblingBelow, SetLayersVisibleCommand, BatchCommand, alignOffsets, distributeOffsets, rasterInsideSelection, DeleteLayersCommand, RasterizeLayerCommand } from "../../lib/ui/panels/Layers.model";
import { History, Rect, Selection, SetLayerPropsCommand, createRasterLayer, createDocument, addLayer } from "../../lib/engine";
import { sampleDoc, byName, names } from "./fixtures";

const ids = ["a", "b", "c", "d", "e"];

describe("multi-select", () => {
  it("plain click selects one and makes it active", () => {
    expect(selectOnClick(ids, ["a", "b"], "a", "d", {})).toEqual({ selected: ["d"], active: "d" });
  });
  it("Ctrl-click toggles membership; removing the active one promotes another", () => {
    expect(selectOnClick(ids, ["a"], "a", "c", { ctrl: true })).toEqual({ selected: ["a", "c"], active: "c" });
    const r = selectOnClick(ids, ["a", "c"], "c", "c", { ctrl: true });
    expect(r.selected).toEqual(["a"]);
    expect(r.active).toBe("a");
    // Can't deselect the last one.
    expect(selectOnClick(ids, ["a"], "a", "a", { ctrl: true })).toEqual({ selected: ["a"], active: "a" });
  });
  it("Shift-click selects the range from the active row in panel order (either direction)", () => {
    expect(selectOnClick(ids, ["b"], "b", "d", { shift: true })).toEqual({ selected: ["b", "c", "d"], active: "d" });
    expect(selectOnClick(ids, ["d"], "d", "a", { shift: true })).toEqual({ selected: ["a", "b", "c", "d"], active: "a" });
    // Ctrl+Shift adds the range to the existing selection.
    expect(selectOnClick(ids, ["a"], "a", "b", { shift: true, ctrl: true }).selected).toEqual(["a", "b"]);
  });
  it("targetLayers = selection ∪ active, in engine order", () => {
    const doc = sampleDoc();
    const t = targetLayers(doc, [byName(doc, "Photo").id]);
    expect(t.map((l) => l.name)).toEqual(["Photo", "Title"]);
    expect(targetLayers(doc, []).map((l) => l.name)).toEqual(["Title"]);
  });
});

describe("context menu enablement", () => {
  it("reflects the clicked layer's kind and position", () => {
    const doc = sampleDoc();
    const title = byName(doc, "Title");
    const st = contextMenuState(doc, title, []);
    expect(st.rasterizeType).toBe(true);
    expect(st.rasterizeShape).toBe(false);
    expect(st.convertToSmart).toBe(false);
    expect(st.createClippingMask).toBe(true);
    expect(st.releaseClippingMask).toBe(false);
    expect(st.linkLayers).toBe(false);
    expect(st.mergeDown).toBe(true); // Shape 1 below
    expect(st.flatten).toBe(true);
    expect(st.groupFromLayers).toBe(true);
  });
  it("group rows can't open Blending Options or be grouped; clipped rows offer Release", () => {
    const doc = sampleDoc();
    doc.activeLayerId = byName(doc, "Group 1").id;
    const g = contextMenuState(doc, byName(doc, "Group 1"), []);
    expect(g.blendingOptions).toBe(false);
    expect(g.groupFromLayers).toBe(false);
    expect(g.createClippingMask).toBe(false);
    const tint = contextMenuState(doc, byName(doc, "Tint"), []);
    expect(tint.releaseClippingMask).toBe(true);
    expect(tint.createClippingMask).toBe(false);
    // Merge Down is off for the bottom layer and when the layer below is a group / adjustment.
    expect(canMergeDown(doc, byName(doc, "Background"))).toBe(false);
    expect(canMergeDown(doc, byName(doc, "Shape 1"))).toBe(false); // Group 1 below
    expect(siblingBelow(doc, byName(doc, "Photo"))).toBeNull();
    expect(canClip(doc, byName(doc, "Photo"))).toBe(false);
  });
  it("multi-selection enables Link Layers and disables Merge Down; delete needs a survivor", () => {
    const doc = sampleDoc();
    const sel = [byName(doc, "Photo").id, byName(doc, "Shape 1").id];
    const st = contextMenuState(doc, byName(doc, "Title"), sel);
    expect(st.linkLayers).toBe(true);
    expect(st.mergeDown).toBe(false);
    expect(st.delete).toBe(true);
    const all = doc.layers.map((l) => l.id);
    expect(contextMenuState(doc, byName(doc, "Title"), all).delete).toBe(false);
  });
});

describe("UI-side commands", () => {
  it("SetLayersVisibleCommand solos and restores (one history step)", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    const next: Record<string, boolean> = {};
    for (const l of doc.layers) next[l.id] = l.name === "Photo" || l.name === "Group 1";
    h.push(new SetLayersVisibleCommand(next, "Hide Other Layers"));
    expect(doc.layers.filter((l) => l.visible).map((l) => l.name)).toEqual(["Group 1", "Photo"]);
    expect(h.entries.length).toBe(1);
    h.undo();
    expect(doc.layers.every((l) => l.visible)).toBe(true);
  });
  it("BatchCommand runs sub-commands and undoes them in reverse", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    const a = byName(doc, "Photo");
    const b = byName(doc, "Shape 1");
    h.push(new BatchCommand("Move", [new SetLayerPropsCommand(a.id, { offset: { x: 3, y: 0 } }), new SetLayerPropsCommand(b.id, { offset: { x: 0, y: 5 } })]));
    expect(a.offset).toEqual({ x: 3, y: 0 });
    expect(b.offset).toEqual({ x: 0, y: 5 });
    h.undo();
    expect(a.offset).toEqual({ x: 0, y: 0 });
    expect(b.offset).toEqual({ x: 0, y: 0 });
  });
  it("DeleteLayersCommand removes groups with their children, never the last layer, and restores", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    h.push(new DeleteLayersCommand([byName(doc, "Group 1").id, byName(doc, "Title").id]));
    expect(names(doc)).toEqual(["Background", "Shape 1"]);
    h.undo();
    expect(names(doc)).toEqual(["Background", "Group 1", "Photo", "Tint", "Shape 1", "Title"]);
    h.push(new DeleteLayersCommand(doc.layers.map((l) => l.id)));
    expect(doc.layers.length).toBe(1);
  });
  it("RasterizeLayerCommand turns type / shape layers into raster layers and undoes", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    h.push(new RasterizeLayerCommand([byName(doc, "Title").id, byName(doc, "Shape 1").id]));
    expect(byName(doc, "Title").kind).toBe("raster");
    expect(byName(doc, "Shape 1").kind).toBe("raster");
    h.undo();
    expect(byName(doc, "Title").kind).toBe("text");
    expect(byName(doc, "Shape 1").kind).toBe("shape");
  });
  it("align / distribute compute offsets against a target rect", () => {
    const doc = createDocument({ width: 100, height: 50, noBackgroundLayer: true });
    const mk = (name: string, x: number) => {
      const l = createRasterLayer(doc, { name, offset: { x, y: 0 } });
      l.raster.fill({ r: 0, g: 0, b: 0, a: 255 }, { x: 0, y: 0, w: 10, h: 10 });
      addLayer(doc, l);
      return l;
    };
    const a = mk("a", 0);
    const b = mk("b", 50);
    const c = mk("c", 60);
    const right = alignOffsets([a, b, c], Rect.ofSize(100, 50), "right");
    expect(right.map((u) => u.offset.x)).toEqual([90, 90, 90]);
    expect(alignOffsets([a], Rect.ofSize(100, 50), "hcenter")[0]!.offset.x).toBe(45);
    const dist = distributeOffsets([a, b, c], "h");
    expect(dist).toEqual([{ id: b.id, offset: { x: 30, y: 0 } }]);
    expect(distributeOffsets([a, b], "h")).toEqual([]);
  });
  it("rasterInsideSelection keeps pixels inside (or outside, inverted) the selection", () => {
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const l = byName(doc, "Background");
    if (l.kind !== "raster") throw new Error();
    const sel = Selection.fromRect(8, 8, Rect.make(0, 0, 4, 8));
    const inside = rasterInsideSelection(l.raster, l.offset, sel);
    expect(inside.getPixel(1, 1).a).toBe(255);
    expect(inside.getPixel(6, 1).a).toBe(0);
    const outside = rasterInsideSelection(l.raster, l.offset, sel, true);
    expect(outside.getPixel(1, 1).a).toBe(0);
    expect(outside.getPixel(6, 1).a).toBe(255);
    expect(rasterInsideSelection(l.raster, l.offset, Selection.none(8, 8)).getPixel(6, 1).a).toBe(255);
  });
});
