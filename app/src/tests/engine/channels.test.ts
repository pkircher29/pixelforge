import { describe, expect, it } from "vitest";
import {
  AddAlphaChannelCommand,
  History,
  PaintMaskCommand,
  Raster,
  Rect,
  RemoveAlphaChannelCommand,
  RenameAlphaChannelCommand,
  ResizeCanvasCommand,
  Selection,
  SetAlphaChannelCommand,
  ToggleQuickMaskCommand,
  addLayer,
  channelViewRaster,
  compositeToRaster,
  createDocument,
  createRasterLayer,
  enterQuickMask,
  exitQuickMask,
  loadChannelAsSelection,
  loadMaskAsSelection,
  overlayQuickMask,
  parseViewChannel,
  quickMaskTarget,
  rgba,
  saveSelectionAsChannel,
} from "../../lib/engine";

describe("alpha channels", () => {
  it("saveSelectionAsChannel stores the selection; loadChannelAsSelection combines", () => {
    const doc = createDocument({ width: 8, height: 8 });
    doc.selection = Selection.fromRect(8, 8, Rect.make(0, 0, 4, 8));
    const ch = saveSelectionAsChannel(doc, "Left");
    const h = new History(doc);
    h.push(new AddAlphaChannelCommand(ch));
    expect(doc.alphaChannels).toHaveLength(1);
    expect(ch.name).toBe("Left");
    expect(ch.mask.getPixel(1, 1).r).toBe(255);
    expect(ch.mask.getPixel(6, 1).r).toBe(0);
    doc.selection = Selection.fromRect(8, 8, Rect.make(2, 0, 4, 8));
    expect(loadChannelAsSelection(doc, ch.id, "replace")!.bbox).toEqual(Rect.make(0, 0, 4, 8));
    expect(loadChannelAsSelection(doc, ch.id, "add")!.bbox).toEqual(Rect.make(0, 0, 6, 8));
    expect(loadChannelAsSelection(doc, ch.id, "intersect")!.bbox).toEqual(Rect.make(2, 0, 2, 8));
    expect(loadChannelAsSelection(doc, ch.id, "subtract")!.bbox).toEqual(Rect.make(4, 0, 2, 8));
    expect(loadChannelAsSelection(doc, ch.id, "replace", true)!.bbox).toEqual(Rect.make(4, 0, 4, 8));
    expect(loadChannelAsSelection(doc, "nope")).toBeNull();
    // Save into an existing channel with a combine mode.
    const merged = saveSelectionAsChannel(doc, undefined, { id: ch.id, mode: "add" });
    expect(merged.id).toBe(ch.id);
    expect(merged.mask.getPixel(5, 1).r).toBe(255);
    h.push(new SetAlphaChannelCommand(ch.id, { mask: merged.mask, opacity: 0.8 }));
    expect(doc.alphaChannels[0]!.opacity).toBe(0.8);
    h.undo();
    expect(doc.alphaChannels[0]!.opacity).toBe(0.5);
    expect(doc.alphaChannels[0]!.mask.getPixel(5, 1).r).toBe(0);
  });

  it("rename / remove commands undo", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const h = new History(doc);
    const ch = saveSelectionAsChannel(doc);
    h.push(new AddAlphaChannelCommand(ch));
    h.push(new RenameAlphaChannelCommand(ch.id, "Mask 1"));
    expect(doc.alphaChannels[0]!.name).toBe("Mask 1");
    h.push(new RemoveAlphaChannelCommand(ch.id));
    expect(doc.alphaChannels).toHaveLength(0);
    h.undo();
    expect(doc.alphaChannels[0]!.name).toBe("Mask 1");
    h.undo();
    expect(doc.alphaChannels[0]!.name).toBe("Alpha 1");
    h.undo();
    expect(doc.alphaChannels).toHaveLength(0);
  });

  it("PaintMaskCommand paints an alpha channel, a layer mask and the quick mask", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const ch = saveSelectionAsChannel(doc);
    doc.alphaChannels.push(ch);
    const cap = PaintMaskCommand.capture(ch.mask, Rect.make(0, 0, 2, 2));
    ch.mask.fill(rgba(255, 255, 255), Rect.make(0, 0, 2, 2));
    const h = new History(doc);
    h.push(PaintMaskCommand.finish({ kind: "alphaChannel", channelId: ch.id }, ch.mask, cap), { alreadyApplied: true });
    expect(ch.mask.getPixel(1, 1).r).toBe(255);
    h.undo();
    expect(ch.mask.getPixel(1, 1).r).toBe(0);
    h.redo();
    expect(ch.mask.getPixel(1, 1).r).toBe(255);
    const l = doc.layers[0]!;
    l.mask = Raster.filled(4, 4, rgba(255, 255, 255));
    const cap2 = PaintMaskCommand.capture(l.mask);
    l.mask.fill(rgba(0, 0, 0));
    const cmd = PaintMaskCommand.finish({ kind: "layerMask", layerId: l.id }, l.mask, cap2);
    h.push(cmd, { alreadyApplied: true });
    expect(cmd.affected()).toEqual([{ layerId: l.id, rect: Rect.make(0, 0, 4, 4) }]);
    h.undo();
    expect(l.mask.getPixel(0, 0).r).toBe(255);
  });

  it("loadMaskAsSelection reads a layer mask at the layer offset", () => {
    const doc = createDocument({ width: 8, height: 8 });
    const l = createRasterLayer(doc, { raster: new Raster(2, 2), offset: { x: 3, y: 3 } });
    l.mask = Raster.filled(2, 2, rgba(255, 255, 255));
    addLayer(doc, l);
    const s = loadMaskAsSelection(doc, l.id)!;
    expect(s.bbox).toEqual(Rect.make(3, 3, 2, 2));
    expect(loadMaskAsSelection(doc, doc.layers[0]!.id)).toBeNull();
  });

  it("alpha channels follow canvas resizes", () => {
    const doc = createDocument({ width: 4, height: 4 });
    doc.selection = Selection.all(4, 4);
    doc.alphaChannels.push(saveSelectionAsChannel(doc));
    const h = new History(doc);
    h.push(new ResizeCanvasCommand(6, 6, { x: 0, y: 0 }));
    expect(doc.alphaChannels[0]!.mask.width).toBe(6);
    expect(doc.alphaChannels[0]!.mask.getPixel(5, 5).r).toBe(0);
    expect(doc.alphaChannels[0]!.mask.getPixel(1, 1).r).toBe(255);
    h.undo();
    expect(doc.alphaChannels[0]!.mask.width).toBe(4);
  });
});

describe("quick mask", () => {
  it("enter converts the selection to a raster and clears the selection; exit converts back", () => {
    const doc = createDocument({ width: 8, height: 8 });
    doc.selection = Selection.fromRect(8, 8, Rect.make(0, 0, 4, 8));
    const qm = enterQuickMask(doc);
    expect(qm.active).toBe(true);
    expect(qm.raster!.getPixel(1, 1).r).toBe(255);
    expect(qm.raster!.getPixel(6, 1).r).toBe(0);
    expect(doc.selection.isEmpty).toBe(true);
    expect(quickMaskTarget(doc)).toBe(qm.raster);
    // Paint the mask: select the right half too.
    qm.raster!.fill(rgba(255, 255, 255), Rect.make(4, 0, 4, 8));
    const sel = exitQuickMask(doc);
    expect(doc.quickMask.active).toBe(false);
    expect(doc.quickMask.raster).toBeNull();
    expect(sel.isAll).toBe(true);
    expect(doc.selection).toBe(sel);
    expect(quickMaskTarget(doc)).toBeNull();
  });

  it("round-trips a soft selection exactly", () => {
    const doc = createDocument({ width: 16, height: 16 });
    const soft = Selection.fromEllipse(16, 16, Rect.make(2, 2, 12, 12)).feather(1);
    doc.selection = soft;
    enterQuickMask(doc);
    const back = exitQuickMask(doc);
    for (let i = 0; i < soft.mask.length; i++) expect(back.mask[i]).toBe(soft.mask[i]);
  });

  it("ToggleQuickMaskCommand is undoable and an empty selection enters as all-masked", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const h = new History(doc);
    h.push(new ToggleQuickMaskCommand(true));
    expect(doc.quickMask.active).toBe(true);
    expect(doc.quickMask.raster!.getPixel(0, 0).r).toBe(0);
    h.undo();
    expect(doc.quickMask.active).toBe(false);
    expect(doc.quickMask.raster).toBeNull();
    h.redo();
    doc.quickMask.raster!.fill(rgba(255, 255, 255), Rect.make(0, 0, 2, 2));
    h.push(new ToggleQuickMaskCommand(false));
    expect(doc.selection.bbox).toEqual(Rect.make(0, 0, 2, 2));
    h.undo();
    expect(doc.quickMask.active).toBe(true);
    expect(doc.selection.isEmpty).toBe(true);
  });

  it("overlayQuickMask tints the masked areas (or the selected ones) at the mask opacity", () => {
    const doc = createDocument({ width: 4, height: 1, background: "white" });
    doc.selection = Selection.fromRect(4, 1, Rect.make(0, 0, 2, 1));
    enterQuickMask(doc);
    const display = compositeToRaster(doc);
    overlayQuickMask(display, doc.quickMask);
    expect(display.getPixel(0, 0)).toEqual(rgba(255, 255, 255)); // selected: untouched
    const masked = display.getPixel(3, 0);
    expect(masked.r).toBe(255);
    expect(Math.abs(masked.g - 128)).toBeLessThanOrEqual(1); // 50 % red tint
    doc.quickMask.maskedAreas = false;
    const d2 = compositeToRaster(doc);
    overlayQuickMask(d2, doc.quickMask);
    expect(d2.getPixel(3, 0)).toEqual(rgba(255, 255, 255));
    expect(Math.abs(d2.getPixel(0, 0).g - 128)).toBeLessThanOrEqual(1);
  });
});

describe("channel views", () => {
  it("parses view ids and renders single channels, alpha channels and masks as gray", () => {
    expect(parseViewChannel("rgb")).toEqual({ kind: "rgb" });
    expect(parseViewChannel("alpha:x1")).toEqual({ kind: "alpha", id: "x1" });
    expect(parseViewChannel("mask")).toEqual({ kind: "mask" });
    const doc = createDocument({ width: 2, height: 1, noBackgroundLayer: true });
    const l = createRasterLayer(doc);
    l.raster.setPixel(0, 0, rgba(200, 100, 50, 255));
    l.raster.setPixel(1, 0, rgba(200, 100, 50, 0));
    addLayer(doc, l);
    const comp = compositeToRaster(doc);
    expect(channelViewRaster(doc, comp, "rgb")).toBeNull();
    const r = channelViewRaster(doc, comp, "r")!;
    expect(r.getPixel(0, 0)).toEqual(rgba(200, 200, 200));
    expect(r.getPixel(1, 0)).toEqual(rgba(0, 0, 0)); // transparent shows black
    expect(channelViewRaster(doc, comp, "g")!.getPixel(0, 0).r).toBe(100);
    expect(channelViewRaster(doc, comp, "b")!.getPixel(0, 0).r).toBe(50);
    const ch = saveSelectionAsChannel(doc);
    ch.mask.setPixel(0, 0, rgba(77, 77, 77));
    doc.alphaChannels.push(ch);
    expect(channelViewRaster(doc, comp, `alpha:${ch.id}`)!.getPixel(0, 0).r).toBe(77);
    expect(channelViewRaster(doc, comp, "alpha:missing")).toBeNull();
    expect(channelViewRaster(doc, comp, "mask", l.id)).toBeNull();
    l.mask = Raster.filled(2, 1, rgba(10, 10, 10));
    expect(channelViewRaster(doc, comp, "mask", l.id)!.getPixel(1, 0).r).toBe(10);
  });
});
