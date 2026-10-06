import { describe, expect, it } from "vitest";
import { History, Raster, Rect, Selection, channelFromSelection, createDocument, newPath, rectPath } from "../../lib/engine";
import { buildChannelRows, clickChannel, toggleChannelEye } from "../../lib/ui/panels/Channels.model";
import { buildPathRows, fillPathCommand, strokePathCommand, pathSelectionCommand, workPathFromSelectionCommand, newPathCommand, savePathCommand, deletePathCommand, duplicatePathCommand } from "../../lib/ui/panels/Paths.model";
import { sampleDoc, byName } from "./fixtures";
import { thumbDims, rowHeight, sampleLayerThumb, sampleMaskThumb, sampleChannelThumb, THUMB_BOX } from "../../lib/ui/panels/thumbnail";

describe("Channels panel model", () => {
  it("lists RGB, R, G, B, alpha channels and the active layer's mask", () => {
    const doc = sampleDoc();
    doc.alphaChannels.push(channelFromSelection(doc, Selection.all(doc.width, doc.height), "Alpha 1"));
    const rows = buildChannelRows(doc, byName(doc, "Tint"), "rgb", []);
    expect(rows.map((r) => r.name)).toEqual(["RGB", "Red", "Green", "Blue", "Alpha 1", "Tint Mask"]);
    expect(rows.map((r) => r.shortcut)).toEqual(["Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+\\"]);
    expect(rows[0]!.selected).toBe(true);
    expect(buildChannelRows(doc, byName(doc, "Photo"), "r", []).map((r) => r.name)).not.toContain("Photo Mask");
  });

  it("click rules: RGB shows all, a colour hides the others, alpha shows only itself", () => {
    const doc = sampleDoc();
    const rows = buildChannelRows(doc, null, "rgb", []);
    expect(clickChannel(rows[0]!)).toEqual({ view: "rgb", hidden: [] });
    expect(clickChannel(rows[1]!)).toEqual({ view: "r", hidden: ["g", "b"] });
    doc.alphaChannels.push(channelFromSelection(doc, Selection.none(doc.width, doc.height), "A"));
    const r2 = buildChannelRows(doc, null, "rgb", []);
    expect(clickChannel(r2[4]!, r2)).toEqual({ view: `alpha:${doc.alphaChannels[0]!.id}`, hidden: ["r", "g", "b"] });
    // Clicking Red with an alpha present also hides the alpha (PS shows only the clicked channel).
    expect(clickChannel(r2[1]!, r2)).toEqual({ view: "r", hidden: ["g", "b", doc.alphaChannels[0]!.id] });
    expect(clickChannel(r2[0]!, r2)).toEqual({ view: "rgb", hidden: [doc.alphaChannels[0]!.id] });
  });

  it("eye rules: hiding colours narrows the view; re-showing returns to RGB; alpha eyes view the alpha", () => {
    const doc = sampleDoc();
    doc.alphaChannels.push(channelFromSelection(doc, Selection.none(doc.width, doc.height), "A"));
    const aid = doc.alphaChannels[0]!.id;
    let st = { view: "rgb" as const, hidden: [] as string[] };
    let rows = buildChannelRows(doc, null, st.view, st.hidden);
    // Hide Red → still composite (G+B visible).
    let n = toggleChannelEye(rows, rows[1]!, st.view, st.hidden);
    expect(n).toEqual({ view: "rgb", hidden: ["r"] });
    // Hide Green → only Blue left → view "b".
    rows = buildChannelRows(doc, null, n.view, n.hidden);
    n = toggleChannelEye(rows, rows[2]!, n.view, n.hidden);
    expect(n.view).toBe("b");
    // Show Red again → two visible → rgb.
    rows = buildChannelRows(doc, null, n.view, n.hidden);
    n = toggleChannelEye(rows, rows[1]!, n.view, n.hidden);
    expect(n.view).toBe("rgb");
    expect(n.hidden).toEqual(["g"]);
    // Turn the alpha eye on → view alpha; off → back to colours.
    rows = buildChannelRows(doc, null, "rgb", ["g", aid]);
    n = toggleChannelEye(rows, rows[4]!, "rgb", ["g", aid]);
    expect(n.view).toBe(`alpha:${aid}`);
    rows = buildChannelRows(doc, null, n.view, n.hidden);
    n = toggleChannelEye(rows, rows[4]!, n.view, n.hidden);
    expect(n.view).toBe("rgb");
    // Hiding RGB hides all colours.
    rows = buildChannelRows(doc, null, "rgb", []);
    n = toggleChannelEye(rows, rows[0]!, "rgb", []);
    expect(n.hidden.sort()).toEqual(["b", "g", "r"]);
    rows = buildChannelRows(doc, null, n.view, n.hidden);
    expect(toggleChannelEye(rows, rows[0]!, n.view, n.hidden)).toEqual({ view: "rgb", hidden: [] });
  });
});

describe("Paths panel model", () => {
  it("lists saved paths then the Work Path (italic), marks the active one", () => {
    const doc = createDocument({ width: 20, height: 20 });
    const work = newPath("Work Path", rectPath(Rect.make(2, 2, 10, 10)).subpaths);
    const saved = newPath("Outline", rectPath(Rect.make(0, 0, 5, 5)).subpaths);
    doc.paths = [work, saved];
    doc.workPathId = work.id;
    const rows = buildPathRows(doc, saved.id);
    expect(rows.map((r) => r.name)).toEqual(["Outline", "Work Path"]);
    expect(rows[1]!.isWork).toBe(true);
    expect(rows[0]!.active).toBe(true);
  });

  it("new / save / duplicate / delete path commands are undoable", () => {
    const doc = createDocument({ width: 20, height: 20 });
    const h = new History(doc);
    const { cmd, id } = newPathCommand(doc);
    h.push(cmd);
    expect(doc.paths.map((p) => p.name)).toEqual(["Path 1"]);
    const sel = workPathFromSelectionCommand({ ...doc, selection: Selection.fromRect(20, 20, Rect.make(4, 4, 8, 8)) });
    expect(sel).not.toBeNull();
    h.push(sel!);
    expect(doc.workPathId).not.toBeNull();
    expect(doc.paths.length).toBe(2);
    h.push(savePathCommand(doc, "Saved")!);
    expect(doc.workPathId).toBeNull();
    expect(doc.paths.map((p) => p.name)).toContain("Saved");
    const dup = duplicatePathCommand(doc, id)!;
    h.push(dup.cmd);
    expect(doc.paths.map((p) => p.name)).toContain("Path 1 copy");
    h.push(deletePathCommand(doc, id));
    expect(doc.paths.find((p) => p.id === id)).toBeUndefined();
    h.undo();
    h.undo();
    h.undo();
    expect(doc.workPathId).not.toBeNull();
    expect(workPathFromSelectionCommand(doc)).toBeNull();
  });

  it("fill / stroke paint onto the pixel layer; make selection honours feather and operation", () => {
    const doc = createDocument({ width: 20, height: 20 });
    const h = new History(doc);
    const bg = doc.layers[0]!;
    if (bg.kind !== "raster") throw new Error();
    const path = rectPath(Rect.make(5, 5, 10, 10));
    h.push(fillPathCommand(doc, bg, path, { r: 255, g: 0, b: 0, a: 255 }));
    expect(bg.raster.getPixel(10, 10).r).toBe(255);
    expect(bg.raster.getPixel(1, 1).a).toBe(0);
    h.undo();
    expect(bg.raster.getPixel(10, 10).a).toBe(0);
    h.push(strokePathCommand(doc, bg, path, 2, { r: 0, g: 0, b: 255, a: 255 }));
    expect(bg.raster.getPixel(5, 10).b).toBeGreaterThan(0);
    expect(bg.raster.getPixel(10, 10).a).toBe(0);
    h.push(pathSelectionCommand(doc, path));
    expect(doc.selection.contains(10, 10)).toBe(true);
    expect(doc.selection.contains(1, 1)).toBe(false);
    h.push(pathSelectionCommand(doc, rectPath(Rect.make(0, 0, 4, 4)), { mode: "add" }));
    expect(doc.selection.contains(1, 1)).toBe(true);
    expect(doc.selection.contains(10, 10)).toBe(true);
    h.push(pathSelectionCommand(doc, rectPath(Rect.make(0, 0, 4, 4)), { mode: "subtract" }));
    expect(doc.selection.contains(1, 1)).toBe(false);
  });
});

describe("thumbnails", () => {
  it("sizes follow PS Small / Medium / Large with the document's aspect", () => {
    expect(rowHeight("none")).toBe(22);
    expect(rowHeight("medium")).toBe(40);
    expect(thumbDims("none", 100, 50)).toEqual({ w: 0, h: 0 });
    const m = thumbDims("medium", 100, 50);
    expect(m.h).toBeLessThanOrEqual(THUMB_BOX.medium.h);
    expect(m.w).toBeLessThanOrEqual(THUMB_BOX.medium.w);
    expect(m.w / m.h).toBeCloseTo(2, 0);
    const tall = thumbDims("medium", 50, 100);
    expect(tall.h).toBe(THUMB_BOX.medium.h);
    expect(tall.w).toBeLessThan(tall.h);
  });

  it("samples layer pixels with document placement, masks on white, channels as gray", () => {
    const doc = sampleDoc();
    const photo = byName(doc, "Photo");
    const out = new Uint8ClampedArray(16 * 12 * 4);
    sampleLayerThumb(photo, doc.width, doc.height, out, 16, 12, "document");
    // Red block at doc (4..16, 4..14) → thumb (2..8, 2..7).
    expect(out[(4 * 16 + 4) * 4]).toBe(200);
    expect(out[(0 * 16 + 0) * 4 + 3]).toBe(0);
    // Layer bounds mode fills the thumb with the content.
    sampleLayerThumb(photo, doc.width, doc.height, out, 16, 12, "bounds");
    expect(out[(6 * 16 + 8) * 4 + 3]).toBe(255);
    const tint = byName(doc, "Tint");
    tint.mask = new Raster(doc.width, doc.height);
    tint.mask.fill({ r: 0, g: 0, b: 0, a: 255 });
    sampleMaskThumb(tint, doc.width, doc.height, out, 16, 12);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
    // A layer without a mask samples to white.
    sampleMaskThumb(photo, doc.width, doc.height, out, 16, 12);
    expect(out[0]).toBe(255);
    const ch = Raster.filled(doc.width, doc.height, { r: 90, g: 1, b: 2, a: 255 });
    sampleChannelThumb(ch, out, 16, 12);
    expect(out[0]).toBe(90);
    expect(out[1]).toBe(90);
    expect(out[2]).toBe(90);
  });
});
