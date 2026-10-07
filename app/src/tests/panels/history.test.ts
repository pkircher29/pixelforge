import { describe, expect, it } from "vitest";
import { buildHistoryRows, iconForLabel, jumpTargetFor, sourceRow, needsFirstSnapshot } from "../../lib/ui/panels/History.model";
import { History, createDocument, createRasterLayer, AddLayerCommand } from "../../lib/engine";

const entries = [
  { label: "Brush Tool", seq: 1 },
  { label: "Rectangular Marquee", seq: 2 },
  { label: "Fill", seq: 3 },
];

describe("history panel row model", () => {
  it("lists the origin state plus one row per entry, highlighting the current one", () => {
    const r = buildHistoryRows({ entries, index: 2, snapshots: [], source: null, opened: false, evicted: 0 });
    expect(r.states.map((s) => s.label)).toEqual(["New", "Brush Tool", "Rectangular Marquee", "Fill"]);
    expect(r.states.filter((s) => s.current).map((s) => s.index)).toEqual([2]);
  });

  it("greys out the states after the current one (redo-jump targets)", () => {
    const r = buildHistoryRows({ entries, index: 1, snapshots: [], source: null, opened: true, evicted: 0 });
    expect(r.states.map((s) => s.undone)).toEqual([false, false, true, true]);
    expect(r.states[0]!.label).toBe("Open");
    expect(jumpTargetFor(r.states[3]!, 1)).toBe(3);
    expect(jumpTargetFor(r.states[1]!, 1)).toBeNull();
  });

  it("puts snapshots on top and the history-brush source on the first snapshot by default", () => {
    const snaps = [
      { id: "s1", name: "Untitled-1", historyIndex: 0 },
      { id: "s2", name: "Snapshot 1", historyIndex: 2 },
    ];
    const r = buildHistoryRows({ entries, index: 2, snapshots: snaps, source: null, opened: false, evicted: 0 });
    expect(r.snapshots.map((s) => s.name)).toEqual(["Untitled-1", "Snapshot 1"]);
    expect(r.snapshots.map((s) => s.isSource)).toEqual([true, false]);
    expect(r.snapshots[1]!.atCurrent).toBe(true);
    expect(r.states.some((s) => s.isSource)).toBe(false);
  });

  it("moves the source column to an explicitly chosen state or snapshot", () => {
    const snaps = [{ id: "s1", name: "A", historyIndex: 0 }];
    const r = buildHistoryRows({ entries, index: 3, snapshots: snaps, source: { kind: "state", index: 2 }, opened: false, evicted: 0 });
    expect(r.states.filter((s) => s.isSource).map((s) => s.index)).toEqual([2]);
    expect(r.snapshots[0]!.isSource).toBe(false);
    expect(sourceRow(null, [])).toEqual({ kind: "state", index: 0 });
    expect(sourceRow({ kind: "snapshot", id: "x" }, snaps)).toEqual({ kind: "snapshot", id: "x" });
  });

  it("names the origin after evicted states and picks tool-like icons", () => {
    const r = buildHistoryRows({ entries, index: 3, snapshots: [], source: null, opened: false, evicted: 4 });
    expect(r.states[0]!.label).toBe("4 earlier states forgotten");
    expect(iconForLabel("Brush Tool")).toBe("brush");
    expect(iconForLabel("Deselect")).toBe("marquee-rect");
    expect(iconForLabel("Something odd")).toBe("document");
    expect(needsFirstSnapshot(0, true)).toBe(true);
    expect(needsFirstSnapshot(1, true)).toBe(false);
    expect(needsFirstSnapshot(0, false)).toBe(false);
  });

  it("matches a live engine History (snapshot + jump)", () => {
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const h = new History(doc);
    h.takeSnapshot("Untitled-1");
    h.push(new AddLayerCommand(createRasterLayer(doc, { name: "A" })));
    h.push(new AddLayerCommand(createRasterLayer(doc, { name: "B" })));
    h.jumpTo(1);
    const r = buildHistoryRows({ entries: h.entries, index: h.index, snapshots: h.snapshots, source: null, opened: false, evicted: h.evictedCount });
    expect(r.states).toHaveLength(3);
    expect(r.states[1]!.current).toBe(true);
    expect(r.states[2]!.undone).toBe(true);
    expect(r.snapshots[0]!.isSource).toBe(true);
  });
});
