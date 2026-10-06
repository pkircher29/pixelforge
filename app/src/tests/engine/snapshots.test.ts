import { describe, expect, it, vi } from "vitest";
import {
  AddLayerCommand,
  History,
  PaintCommand,
  Raster,
  Rect,
  ReplaceLayerPixelsCommand,
  SetLayerPropsCommand,
  SnapshotCommand,
  captureDocState,
  createDocument,
  createRasterLayer,
  restoreDocState,
  rgba,
  type RasterLayer,
} from "../../lib/engine";

function fillCmd(l: RasterLayer, c: ReturnType<typeof rgba>): ReplaceLayerPixelsCommand {
  return ReplaceLayerPixelsCommand.whole("fill", l, Raster.filled(l.raster.width, l.raster.height, c));
}

describe("document state capture", () => {
  it("captureDocState is independent of the live document and restoreDocState copies again", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const state = captureDocState(doc);
    const l = doc.layers[0] as RasterLayer;
    l.raster.fill(rgba(0, 0, 0));
    doc.layers = [];
    expect(state.layers).toHaveLength(1);
    expect((state.layers[0] as RasterLayer).raster.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    restoreDocState(doc, state);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]).not.toBe(state.layers[0]);
    expect(doc.layers[0]!.id).toBe(l.id);
    expect((doc.layers[0] as RasterLayer).raster.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    expect(state.bytes).toBe(4 * 4 * 4 + 16);
  });
});

describe("History snapshots", () => {
  it("takeSnapshot records the state; restoreSnapshot is an undoable step", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const onChange = vi.fn();
    const h = new History(doc, { onChange });
    const snap = h.takeSnapshot("Start");
    expect(h.snapshots).toHaveLength(1);
    expect(snap.name).toBe("Start");
    expect(snap.historyIndex).toBe(0);
    expect(h.snapshotBytes).toBe(snap.bytes);
    expect(onChange).toHaveBeenCalledTimes(1);
    h.push(fillCmd(l, rgba(255, 0, 0)));
    h.push(fillCmd(l, rgba(0, 255, 0)));
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(0, 255, 0));
    expect(h.restoreSnapshot(snap.id)).toBe(true);
    expect(h.restoreSnapshot("nope")).toBe(false);
    expect((doc.layers[0] as RasterLayer).raster.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    expect(h.entries).toHaveLength(3);
    expect(h.entries[2]!.command).toBeInstanceOf(SnapshotCommand);
    h.undo();
    expect((doc.layers[0] as RasterLayer).raster.getPixel(0, 0)).toEqual(rgba(0, 255, 0));
    h.redo();
    expect((doc.layers[0] as RasterLayer).raster.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    expect(h.renameSnapshot(snap.id, "Begin")).toBe(true);
    expect(h.snapshots[0]!.name).toBe("Begin");
    expect(h.deleteSnapshot(snap.id)).toBe(true);
    expect(h.snapshots).toHaveLength(0);
    expect(h.deleteSnapshot(snap.id)).toBe(false);
  });

  it("snapshot layer structure survives layer removal", () => {
    const doc = createDocument({ width: 2, height: 2, background: "white" });
    const h = new History(doc);
    const extra = createRasterLayer(doc, { name: "extra" });
    h.push(new AddLayerCommand(extra));
    const snap = h.takeSnapshot();
    doc.layers = doc.layers.filter((x) => x.id !== extra.id);
    h.restoreSnapshot(snap.id);
    expect(doc.layers.map((x) => x.name)).toEqual(["Background", "extra"]);
    expect(h.snapshotRaster(snap.id, extra.id)).not.toBeNull();
    expect(h.snapshotRaster(snap.id, "missing")).toBeNull();
  });
});

describe("History.rasterAt (History Brush source)", () => {
  it("returns the layer's pixels at a past state without disturbing the live document or observers", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const onApply = vi.fn();
    const onChange = vi.fn();
    const h = new History(doc, { onApply, onChange });
    h.push(fillCmd(l, rgba(255, 0, 0))); // index 1
    h.push(fillCmd(l, rgba(0, 255, 0))); // index 2
    h.push(new SetLayerPropsCommand(l.id, { opacity: 0.5 })); // index 3
    onApply.mockClear();
    onChange.mockClear();
    doc.dirty = false;
    const r0 = h.rasterAt(0, l.id)!;
    const r1 = h.rasterAt(1, l.id)!;
    const r3 = h.rasterAt(3, l.id)!;
    expect(r0.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    expect(r1.getPixel(0, 0)).toEqual(rgba(255, 0, 0));
    expect(r3.getPixel(0, 0)).toEqual(rgba(0, 255, 0));
    expect(r3).not.toBe(l.raster);
    // Live document unchanged, nobody notified, dirty flag restored.
    expect(h.index).toBe(3);
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(0, 255, 0));
    expect(l.opacity).toBe(0.5);
    expect(onApply).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(doc.dirty).toBe(false);
    expect(h.rasterAt(0, "missing")).toBeNull();
  });

  it("uses a snapshot taken at that index directly and resolves HistorySource", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const h = new History(doc);
    h.push(fillCmd(l, rgba(255, 0, 0)));
    const snap = h.takeSnapshot();
    expect(snap.historyIndex).toBe(1);
    h.push(fillCmd(l, rgba(0, 0, 255)));
    const fromSnap = h.rasterFromSource({ kind: "snapshot", id: snap.id }, l.id)!;
    expect(fromSnap.getPixel(0, 0)).toEqual(rgba(255, 0, 0));
    const fromState = h.rasterFromSource({ kind: "state", index: 1 }, l.id)!;
    expect(fromState.getPixel(0, 0)).toEqual(rgba(255, 0, 0));
    expect(h.rasterFromSource({ kind: "state", index: 2 }, l.id)!.getPixel(0, 0)).toEqual(rgba(0, 0, 255));
  });

  it("snapshot indices track eviction and redo-tail drops", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const h = new History(doc, { budgetBytes: 4 * 4 * 4 * 2 + 10 });
    h.push(fillCmd(l, rgba(1, 1, 1)));
    const snap = h.takeSnapshot();
    expect(snap.historyIndex).toBe(1);
    h.push(fillCmd(l, rgba(2, 2, 2)));
    h.push(fillCmd(l, rgba(3, 3, 3))); // evicts the first entry
    expect(h.evictedCount).toBeGreaterThan(0);
    expect(h.snapshots[0]!.historyIndex).toBe(0);
    h.undo();
    h.undo();
    const snap2 = h.takeSnapshot();
    h.jumpTo(h.entries.length);
    snap2.historyIndex = 5; // pretend it points past the end
    h.undo();
    h.push(fillCmd(l, rgba(4, 4, 4)));
    expect(h.snapshots[1]!.historyIndex).toBeLessThanOrEqual(h.index);
  });

  it("works with paint commands pushed as already applied", () => {
    const doc = createDocument({ width: 4, height: 4, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const h = new History(doc);
    const cap = PaintCommand.capture(l, Rect.make(0, 0, 2, 2));
    l.raster.fill(rgba(0, 0, 0), Rect.make(0, 0, 2, 2));
    h.push(PaintCommand.finish(l, cap), { alreadyApplied: true });
    expect(h.rasterAt(0, l.id)!.getPixel(0, 0)).toEqual(rgba(255, 255, 255));
    expect(h.rasterAt(1, l.id)!.getPixel(0, 0)).toEqual(rgba(0, 0, 0));
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(0, 0, 0));
  });
});
