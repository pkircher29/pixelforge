import { describe, expect, it, vi } from "vitest";
import {
  AddLayerCommand,
  BlendMode,
  CropCanvasCommand,
  FlattenCommand,
  History,
  MergeDownCommand,
  PaintCommand,
  Raster,
  Rect,
  RemoveLayerCommand,
  ReorderLayerCommand,
  ReplaceLayerPixelsCommand,
  ResizeCanvasCommand,
  ResizeImageCommand,
  Selection,
  SetLayerPropsCommand,
  SetSelectionCommand,
  addLayer,
  createDocument,
  createRasterLayer,
  flipLayerCommand,
  getRasterLayer,
  rgba,
  type Command,
  type Document,
} from "../../lib/engine";

/** A counter command with a configurable snapshot size. */
class Inc implements Command {
  readonly label: string;
  constructor(
    private readonly target: { n: number },
    private readonly bytes = 0,
    label = "inc",
  ) {
    this.label = label;
  }
  do(): void {
    this.target.n++;
  }
  undo(): void {
    this.target.n--;
  }
  byteSize(): number {
    return this.bytes;
  }
}

function twoLayerDoc(): { doc: Document; top: string; bottom: string } {
  const doc = createDocument({ width: 4, height: 4, background: "white" });
  const top = createRasterLayer(doc, { name: "top" });
  top.raster.fill(rgba(255, 0, 0, 128));
  addLayer(doc, top);
  return { doc, top: top.id, bottom: doc.layers[0]!.id };
}

describe("History core", () => {
  it("push executes, undo/redo move the cursor, labels are exposed", () => {
    const doc = createDocument({ width: 2, height: 2 });
    const t = { n: 0 };
    const h = new History(doc);
    h.push(new Inc(t, 0, "one"));
    h.push(new Inc(t, 0, "two"));
    expect(t.n).toBe(2);
    expect(h.entries.map((e) => e.label)).toEqual(["one", "two"]);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe("two");
    h.undo();
    expect(t.n).toBe(1);
    expect(h.redoLabel).toBe("two");
    h.redo();
    expect(t.n).toBe(2);
    expect(h.redo()).toBe(false);
    expect(doc.dirty).toBe(true);
  });

  it("jumpTo applies the right number of commands in either direction", () => {
    const doc = createDocument({ width: 2, height: 2 });
    const t = { n: 0 };
    const h = new History(doc);
    for (let i = 0; i < 5; i++) h.push(new Inc(t));
    h.jumpTo(1);
    expect(t.n).toBe(1);
    expect(h.index).toBe(1);
    h.jumpTo(4);
    expect(t.n).toBe(4);
    h.jumpTo(99);
    expect(t.n).toBe(5);
    h.jumpTo(-3);
    expect(t.n).toBe(0);
  });

  it("push after undo discards the redo tail", () => {
    const doc = createDocument({ width: 2, height: 2 });
    const t = { n: 0 };
    const h = new History(doc);
    h.push(new Inc(t, 0, "a"));
    h.push(new Inc(t, 0, "b"));
    h.undo();
    h.push(new Inc(t, 0, "c"));
    expect(h.entries.map((e) => e.label)).toEqual(["a", "c"]);
    expect(h.canRedo).toBe(false);
  });

  it("evicts the oldest applied entries when over the memory budget", () => {
    const doc = createDocument({ width: 2, height: 2 });
    const t = { n: 0 };
    const h = new History(doc, { budgetBytes: 1000 });
    h.push(new Inc(t, 400, "a"));
    h.push(new Inc(t, 400, "b"));
    h.push(new Inc(t, 400, "c"));
    expect(h.entries.map((e) => e.label)).toEqual(["b", "c"]);
    expect(h.evictedCount).toBe(1);
    expect(h.bytes).toBe(800);
    expect(h.index).toBe(2);
    h.undo();
    h.undo();
    expect(t.n).toBe(1); // "a" is permanent
    expect(h.canUndo).toBe(false);
    h.budgetBytes = 100; // redo tail is dropped from the top
    expect(h.entries).toHaveLength(0);
  });

  it("merges consecutive mergeable commands and calls onChange / onApply", () => {
    const { doc, top } = twoLayerDoc();
    const onChange = vi.fn();
    const onApply = vi.fn();
    const h = new History(doc, { onChange, onApply });
    h.push(new SetLayerPropsCommand(top, { opacity: 0.8 }));
    h.push(new SetLayerPropsCommand(top, { opacity: 0.6 }));
    h.push(new SetLayerPropsCommand(top, { opacity: 0.4 }));
    expect(h.entries).toHaveLength(1);
    expect(getRasterLayer(doc, top).opacity).toBe(0.4);
    h.push(new SetLayerPropsCommand(top, { visible: false })); // not mergeable
    expect(h.entries).toHaveLength(2);
    h.undo();
    h.undo();
    expect(getRasterLayer(doc, top).opacity).toBe(1);
    expect(getRasterLayer(doc, top).visible).toBe(true);
    expect(onApply).toHaveBeenLastCalledWith(expect.any(SetLayerPropsCommand), "undo");
    expect(onChange).toHaveBeenCalled();
    h.clear();
    expect(h.entries).toHaveLength(0);
  });
});

describe("pixel commands", () => {
  it("PaintCommand restores and re-applies only the dirty rect, and reports it", () => {
    const { doc, top } = twoLayerDoc();
    const layer = getRasterLayer(doc, top);
    const h = new History(doc);
    const captured = PaintCommand.capture(layer, Rect.make(1, 1, 2, 2));
    layer.raster.fill(rgba(0, 255, 0), Rect.make(1, 1, 2, 2));
    const cmd = PaintCommand.finish(layer, captured, "Brush");
    h.push(cmd, { alreadyApplied: true });
    expect(cmd.affected()).toEqual([{ layerId: top, rect: { x: 1, y: 1, w: 2, h: 2 } }]);
    expect(cmd.byteSize()).toBe(2 * 16);
    expect(layer.raster.getPixel(1, 1)).toEqual(rgba(0, 255, 0, 255));
    h.undo();
    expect(layer.raster.getPixel(1, 1)).toEqual(rgba(255, 0, 0, 128));
    expect(layer.raster.getPixel(0, 0)).toEqual(rgba(255, 0, 0, 128));
    h.redo();
    expect(layer.raster.getPixel(2, 2)).toEqual(rgba(0, 255, 0, 255));
    expect(layer.raster.getPixel(3, 3)).toEqual(rgba(255, 0, 0, 128));
  });

  it("PaintCommand.finish can shrink to a smaller dirty rect", () => {
    const { doc, top } = twoLayerDoc();
    const layer = getRasterLayer(doc, top);
    const captured = PaintCommand.capture(layer);
    layer.raster.setPixel(2, 2, rgba(1, 2, 3));
    const cmd = PaintCommand.finish(layer, captured, "Dot", Rect.make(2, 2, 1, 1));
    expect(cmd.rect).toEqual({ x: 2, y: 2, w: 1, h: 1 });
    cmd.undo(doc);
    expect(layer.raster.getPixel(2, 2)).toEqual(rgba(255, 0, 0, 128));
  });

  it("ReplaceLayerPixelsCommand snapshots lazily and undoes", () => {
    const { doc, top } = twoLayerDoc();
    const layer = getRasterLayer(doc, top);
    const h = new History(doc);
    const cmd = new ReplaceLayerPixelsCommand("Invert", top, Rect.make(0, 0, 2, 4), Raster.filled(2, 4, rgba(0, 0, 255)));
    expect(cmd.byteSize()).toBe(32);
    h.push(cmd);
    expect(cmd.byteSize()).toBe(64);
    expect(layer.raster.getPixel(1, 3)).toEqual(rgba(0, 0, 255, 255));
    expect(layer.raster.getPixel(2, 3)).toEqual(rgba(255, 0, 0, 128));
    h.undo();
    expect(layer.raster.getPixel(1, 3)).toEqual(rgba(255, 0, 0, 128));
    expect(() => new ReplaceLayerPixelsCommand("x", top, Rect.make(0, 0, 2, 2), new Raster(1, 1))).toThrow();
  });
});

describe("layer commands", () => {
  it("AddLayer / RemoveLayer / Reorder undo restores order and active layer", () => {
    const { doc, top, bottom } = twoLayerDoc();
    const h = new History(doc);
    const extra = createRasterLayer(doc, { name: "extra" });
    doc.activeLayerId = bottom;
    h.push(new AddLayerCommand(extra));
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "extra", "top"]);
    expect(doc.activeLayerId).toBe(extra.id);
    h.undo();
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "top"]);
    expect(doc.activeLayerId).toBe(bottom);
    h.redo();
    expect(doc.layers[1]!.id).toBe(extra.id);

    h.push(new ReorderLayerCommand(top, 0));
    expect(doc.layers[0]!.id).toBe(top);
    h.undo();
    expect(doc.layers[2]!.id).toBe(top);

    h.push(new RemoveLayerCommand(extra.id));
    expect(doc.layers).toHaveLength(2);
    h.undo();
    expect(doc.layers[1]!.id).toBe(extra.id);
  });

  it("MergeDown / Flatten undo restore the original layer objects and rasters", () => {
    const { doc, top, bottom } = twoLayerDoc();
    const h = new History(doc);
    const bottomRaster = getRasterLayer(doc, bottom).raster;
    h.push(new MergeDownCommand(top));
    expect(doc.layers).toHaveLength(1);
    expect(getRasterLayer(doc, bottom).raster).not.toBe(bottomRaster);
    h.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([bottom, top]);
    expect(getRasterLayer(doc, bottom).raster).toBe(bottomRaster);
    h.redo();
    expect(doc.layers).toHaveLength(1);
    h.undo();
    h.push(new FlattenCommand());
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.id).not.toBe(bottom);
    h.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([bottom, top]);
    expect(h.entries[0]!.bytes).toBeGreaterThan(0);
  });

  it("TransformLayer (flip) and SetSelection undo", () => {
    const { doc, top } = twoLayerDoc();
    const layer = getRasterLayer(doc, top);
    layer.raster.setPixel(0, 0, rgba(0, 0, 0));
    const h = new History(doc);
    h.push(flipLayerCommand(doc, top, "h"));
    expect(layer.raster.getPixel(3, 0)).toEqual(rgba(0, 0, 0, 255));
    h.undo();
    expect(layer.raster.getPixel(0, 0)).toEqual(rgba(0, 0, 0, 255));
    const sel = Selection.fromRect(4, 4, Rect.make(0, 0, 2, 2));
    h.push(new SetSelectionCommand(sel));
    expect(doc.selection).toBe(sel);
    h.undo();
    expect(doc.selection.isEmpty).toBe(true);
    h.redo();
    expect(doc.selection).toBe(sel);
  });

  it("SetLayerProps label reflects the property", () => {
    expect(new SetLayerPropsCommand("x", { blendMode: BlendMode.Screen }).label).toBe("Blend Mode");
    expect(new SetLayerPropsCommand("x", { visible: false }).label).toBe("Hide Layer");
  });
});

describe("canvas commands", () => {
  it("ResizeCanvas with centre anchor shifts content and undoes exactly", () => {
    const doc = createDocument({ width: 4, height: 4, noBackgroundLayer: true });
    const l = createRasterLayer(doc);
    l.raster.setPixel(0, 0, rgba(1, 2, 3));
    addLayer(doc, l);
    doc.selection = Selection.fromRect(4, 4, Rect.make(0, 0, 1, 1));
    const h = new History(doc);
    h.push(new ResizeCanvasCommand(6, 6, { x: 0.5, y: 0.5 }));
    expect(doc.width).toBe(6);
    expect(l.raster.width).toBe(6);
    expect(l.raster.getPixel(1, 1)).toEqual(rgba(1, 2, 3, 255));
    expect(doc.selection.bbox).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    h.undo();
    expect(doc.width).toBe(4);
    expect(l.raster.width).toBe(4);
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(1, 2, 3, 255));
    expect(doc.selection.bbox).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("ResizeImage scales layers and the selection; Crop cuts them", () => {
    const doc = createDocument({ width: 2, height: 2, noBackgroundLayer: true });
    const l = createRasterLayer(doc);
    l.raster.setPixel(1, 1, rgba(9, 9, 9));
    addLayer(doc, l);
    doc.selection = Selection.all(2, 2);
    const h = new History(doc);
    h.push(new ResizeImageCommand(4, 4, "nearest"));
    expect(l.raster.width).toBe(4);
    expect(l.raster.getPixel(3, 3)).toEqual(rgba(9, 9, 9, 255));
    expect(l.raster.getPixel(1, 1).a).toBe(0);
    expect(doc.selection.isAll).toBe(true);
    h.push(new CropCanvasCommand(Rect.make(2, 2, 2, 2)));
    expect(doc.width).toBe(2);
    expect(l.raster.getPixel(1, 1)).toEqual(rgba(9, 9, 9, 255));
    h.undo();
    h.undo();
    expect(doc.width).toBe(2);
    expect(l.raster.getPixel(1, 1)).toEqual(rgba(9, 9, 9, 255));
    expect(l.raster.getPixel(0, 0).a).toBe(0);
    expect(() => new ResizeCanvasCommand(0, 5)).toThrow();
  });
});
