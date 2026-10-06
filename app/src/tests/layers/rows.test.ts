import { describe, expect, it } from "vitest";
import { buildRows, kindOf, passesFilter, presentEffects, anyEffectEnabled, NO_FILTER, type LayerRowModel, type RowFilter } from "../../lib/ui/panels/Layers.model";
import { sampleDoc, byName } from "./fixtures";

const layerRows = (rows: ReturnType<typeof buildRows>) => rows.filter((r): r is LayerRowModel => r.kind === "layer");

describe("Layers panel rows", () => {
  it("lists layers top-to-bottom with group children indented", () => {
    const doc = sampleDoc();
    const rows = layerRows(buildRows(doc));
    expect(rows.map((r) => r.name)).toEqual(["Title", "Shape 1", "Group 1", "Tint", "Photo", "Background"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 0, 1, 1, 0]);
    expect(rows[2]!.isGroup).toBe(true);
  });

  it("marks clipped layers (↳) only when they have a base, and masks / effects / locks", () => {
    const doc = sampleDoc();
    const rows = layerRows(buildRows(doc));
    const tint = rows.find((r) => r.name === "Tint")!;
    expect(tint.clipped).toBe(true);
    expect(tint.hasMask).toBe(true);
    const title = rows.find((r) => r.name === "Title")!;
    expect(title.hasEffects).toBe(true);
    expect(title.active).toBe(true);
    expect(title.selected).toBe(true);
    // A clipToBelow layer at the bottom of its container has no base → not drawn as clipped.
    byName(doc, "Background").clipToBelow = true;
    expect(layerRows(buildRows(doc)).find((r) => r.name === "Background")!.clipped).toBe(false);
    byName(doc, "Photo").lock.pixels = true;
    const photo = layerRows(buildRows(doc)).find((r) => r.name === "Photo")!;
    expect(photo.anyLock).toBe(true);
    expect(photo.locked).toBe(false);
  });

  it("hides children of collapsed groups", () => {
    const doc = sampleDoc();
    const g = byName(doc, "Group 1");
    if (g.kind === "group") g.collapsed = true;
    const rows = layerRows(buildRows(doc));
    expect(rows.map((r) => r.name)).toEqual(["Title", "Shape 1", "Group 1", "Background"]);
    expect(rows[2]!.collapsed).toBe(true);
  });

  it("adds an Effects header plus one row per effect when expanded", () => {
    const doc = sampleDoc();
    const title = byName(doc, "Title");
    const rows = buildRows(doc, { expandedEffects: [title.id] });
    const kinds = rows.slice(0, 4).map((r) => r.kind);
    expect(kinds).toEqual(["layer", "effects", "effect", "effect"]);
    const labels = rows.filter((r) => r.kind === "effect").map((r) => (r.kind === "effect" ? r.label : ""));
    // PS panel order: Stroke before Drop Shadow.
    expect(labels).toEqual(["Stroke", "Drop Shadow"]);
    expect(rows[1]!.kind === "effects" && rows[1]!.visible).toBe(true);
    title.effects!.stroke!.enabled = false;
    const rows2 = buildRows(doc, { expandedEffects: [title.id] });
    const stroke = rows2.find((r) => r.kind === "effect" && r.effect === "stroke");
    expect(stroke && stroke.kind === "effect" ? stroke.visible : null).toBe(false);
    expect(presentEffects(title.effects)).toEqual(["stroke", "dropShadow"]);
    expect(anyEffectEnabled(title.effects)).toBe(true);
    title.effects!.dropShadow!.enabled = false;
    expect(anyEffectEnabled(title.effects)).toBe(false);
  });

  it("does not add effect rows when the layer is not expanded", () => {
    const doc = sampleDoc();
    expect(buildRows(doc).every((r) => r.kind === "layer")).toBe(true);
  });

  it("filters by kind, keeping groups that contain a match", () => {
    const doc = sampleDoc();
    const f: RowFilter = { on: true, mode: "kind", kinds: ["adjustment"], name: "", color: null };
    const rows = layerRows(buildRows(doc, { filter: f }));
    expect(rows.map((r) => r.name)).toEqual(["Group 1", "Tint"]);
    const pixel = layerRows(buildRows(doc, { filter: { ...f, kinds: ["pixel"] } }));
    expect(pixel.map((r) => r.name)).toEqual(["Group 1", "Photo", "Background"]);
    const types = layerRows(buildRows(doc, { filter: { ...f, kinds: ["type", "shape"] } }));
    expect(types.map((r) => r.name)).toEqual(["Title", "Shape 1"]);
  });

  it("filters by name text and by layer color; the switch turns filtering off", () => {
    const doc = sampleDoc();
    byName(doc, "Photo").color = "red";
    const byNameF: RowFilter = { on: true, mode: "name", kinds: [], name: "ti", color: null };
    expect(layerRows(buildRows(doc, { filter: byNameF })).map((r) => r.name)).toEqual(["Title", "Group 1", "Tint"]);
    const byColor: RowFilter = { on: true, mode: "color", kinds: [], name: "", color: "red" };
    expect(layerRows(buildRows(doc, { filter: byColor })).map((r) => r.name)).toEqual(["Group 1", "Photo"]);
    expect(layerRows(buildRows(doc, { filter: { ...byNameF, on: false } })).length).toBe(6);
    expect(layerRows(buildRows(doc, { filter: NO_FILTER })).length).toBe(6);
  });

  it("maps layer kinds to filter buckets", () => {
    const doc = sampleDoc();
    expect(kindOf(byName(doc, "Photo"))).toBe("pixel");
    expect(kindOf(byName(doc, "Tint"))).toBe("adjustment");
    expect(kindOf(byName(doc, "Title"))).toBe("type");
    expect(kindOf(byName(doc, "Shape 1"))).toBe("shape");
    expect(kindOf(byName(doc, "Group 1"))).toBeNull();
    expect(passesFilter(byName(doc, "Group 1"), { on: true, mode: "kind", kinds: ["pixel"], name: "", color: null })).toBe(false);
    expect(passesFilter(byName(doc, "Group 1"), { on: true, mode: "kind", kinds: [], name: "", color: null })).toBe(true);
  });

  it("marks multi-selected rows", () => {
    const doc = sampleDoc();
    const ids = [byName(doc, "Photo").id, byName(doc, "Shape 1").id];
    const rows = layerRows(buildRows(doc, { selected: ids }));
    expect(rows.filter((r) => r.selected).map((r) => r.name)).toEqual(["Title", "Shape 1", "Photo"]);
    expect(rows.filter((r) => r.active).map((r) => r.name)).toEqual(["Title"]);
  });
});
