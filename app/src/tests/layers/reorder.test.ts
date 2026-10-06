import { describe, expect, it } from "vitest";
import { History } from "../../lib/engine";
import { computeDrop, resolveDrop, reorderTarget, type RowGeom } from "../../lib/ui/panels/layer-reorder";
import { MoveLayerToCommand } from "../../lib/ui/panels/Layers.model";
import { sampleDoc, byName, names } from "./fixtures";

/** Rows as the panel renders them (top → bottom), 40 px each. */
function geoms(doc: ReturnType<typeof sampleDoc>): RowGeom[] {
  const order = ["Title", "Shape 1", "Group 1", "Tint", "Photo", "Background"];
  return order.map((n, i) => {
    const l = byName(doc, n);
    return { id: l.id, top: i * 40, height: 40, isGroup: l.kind === "group", expanded: l.kind === "group" && !l.collapsed, parentId: l.parentId };
  });
}

describe("drag reorder math", () => {
  it("reorderTarget keeps the v0.1 contract", () => {
    expect(reorderTarget(0, 2, true)).toBe(2);
    expect(reorderTarget(2, 0, false)).toBe(0);
    expect(reorderTarget(1, 3, true, 2)).toBe(2);
    expect(reorderTarget(3, 3, true)).toBe(3);
  });

  it("computeDrop: thirds of a row → above / into (groups only) / below, never onto the dragged block", () => {
    const doc = sampleDoc();
    const g = geoms(doc);
    const title = byName(doc, "Title").id;
    const group = byName(doc, "Group 1").id;
    expect(computeDrop(g, 85, title)).toEqual({ id: g[2]!.id, pos: "above" });
    expect(computeDrop(g, 100, title)).toEqual({ id: group, pos: "into" });
    expect(computeDrop(g, 115, title)).toEqual({ id: group, pos: "below" });
    // Dragging a group: the middle third of another group is "below", not "into".
    expect(computeDrop(g, 100, byName(doc, "Shape 1").id, [], true)).toEqual({ id: group, pos: "below" });
    // The dragged group's children are skipped: y over "Tint" resolves to the next candidate.
    const tint = byName(doc, "Tint").id;
    const photo = byName(doc, "Photo").id;
    const d = computeDrop(g, 130, group, [tint, photo], true);
    expect(d).toEqual({ id: byName(doc, "Shape 1").id, pos: "below" });
    expect(computeDrop(g, 190, group, [tint, photo], true)).toEqual({ id: byName(doc, "Background").id, pos: "above" });
    // Above the first row / below the last row.
    expect(computeDrop(g, -5, tint)).toEqual({ id: title, pos: "above" });
    expect(computeDrop(g, 500, tint)).toEqual({ id: byName(doc, "Background").id, pos: "below" });
    expect(computeDrop([], 10, title)).toBeNull();
  });

  it("resolveDrop: above a top-level row lands after its block, below lands before it", () => {
    const doc = sampleDoc();
    const bg = byName(doc, "Background");
    const title = byName(doc, "Title");
    // Drag Title below Background → index 0, top level.
    expect(resolveDrop(doc, title.id, { id: bg.id, pos: "below" })).toEqual({ toIndex: 0, parentId: null });
    // Drag Background above Title → after Title's block (5+1=6) minus its own block (1) = 5.
    expect(resolveDrop(doc, bg.id, { id: title.id, pos: "above" })).toEqual({ toIndex: 5, parentId: null });
  });

  it("resolveDrop: into a group puts the layer at the top inside it; below an expanded group header too", () => {
    const doc = sampleDoc();
    const group = byName(doc, "Group 1");
    const shape = byName(doc, "Shape 1");
    const r = resolveDrop(doc, shape.id, { id: group.id, pos: "into" })!;
    expect(r.parentId).toBe(group.id);
    // Group block = [1,4): raw index 4, shape (index 4) is not before it → 4.
    expect(r.toIndex).toBe(4);
    expect(resolveDrop(doc, shape.id, { id: group.id, pos: "below" })).toEqual({ toIndex: 4, parentId: group.id });
    const g = group.kind === "group" ? group : null;
    g!.collapsed = true;
    expect(resolveDrop(doc, shape.id, { id: group.id, pos: "below" })).toEqual({ toIndex: 1, parentId: null });
  });

  it("resolveDrop: dragging out of a group next to a top-level row clears the parent; groups stay top level", () => {
    const doc = sampleDoc();
    const photo = byName(doc, "Photo");
    const title = byName(doc, "Title");
    expect(resolveDrop(doc, photo.id, { id: title.id, pos: "above" })).toEqual({ toIndex: 5, parentId: null });
    const group = byName(doc, "Group 1");
    // A group dragged above a child of itself is refused; above another child-less target works.
    expect(resolveDrop(doc, group.id, { id: photo.id, pos: "above" })).toBeNull();
    const r = resolveDrop(doc, group.id, { id: title.id, pos: "above" })!;
    expect(r.parentId).toBeNull();
    expect(r.toIndex).toBe(6 - 3);
    expect(resolveDrop(doc, group.id, { id: group.id, pos: "above" })).toBeNull();
  });

  it("MoveLayerToCommand reparents, reorders, releases a lost clip, and undoes exactly", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    const shape = byName(doc, "Shape 1");
    const group = byName(doc, "Group 1");
    const r = resolveDrop(doc, shape.id, { id: group.id, pos: "into" })!;
    h.push(new MoveLayerToCommand(shape.id, r.toIndex, r.parentId));
    expect(names(doc)).toEqual(["Background", "Group 1", "Photo", "Tint", "Shape 1", "Title"]);
    expect(shape.parentId).toBe(group.id);
    h.undo();
    expect(names(doc)).toEqual(["Background", "Group 1", "Photo", "Tint", "Shape 1", "Title"]);
    expect(shape.parentId).toBeNull();
    // Tint is clipped to Photo; moving Tint to the bottom of the document loses its base → clip released.
    const tint = byName(doc, "Tint");
    h.push(new MoveLayerToCommand(tint.id, 0, null));
    expect(names(doc)[0]).toBe("Tint");
    expect(tint.clipToBelow).toBe(false);
    h.undo();
    expect(tint.clipToBelow).toBe(true);
    expect(tint.parentId).toBe(group.id);
    expect(names(doc)).toEqual(["Background", "Group 1", "Photo", "Tint", "Shape 1", "Title"]);
  });
});
