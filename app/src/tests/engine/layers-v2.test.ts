import { describe, expect, it } from "vitest";
import {
  AddLayerCommand,
  ApplyMaskCommand,
  BlendMode,
  History,
  LayerLockedError,
  LinkLayersCommand,
  MoveLayersCommand,
  PaintCommand,
  Raster,
  Rect,
  ReplaceLayerPixelsCommand,
  Selection,
  SetAdjustmentParamsCommand,
  SetClipToBelowCommand,
  SetFillLayerCommand,
  SetFillOpacityCommand,
  SetLayerColorCommand,
  SetLayerEffectsCommand,
  SetLayerLockCommand,
  SetLayerMaskCommand,
  SetLayerPropsCommand,
  SetMaskEnabledCommand,
  SetShapeLayerCommand,
  SetTextLayerCommand,
  TransformLayerCommand,
  addLayer,
  applyTransparencyLock,
  clipBaseOf,
  clippedLayersOf,
  compositeToRaster,
  createAdjustmentLayer,
  createDocument,
  createFillLayer,
  createGroupLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  defaultStroke,
  defringe,
  documentByteSize,
  duplicateLayer,
  gradientFill,
  groupLayers,
  isEffectivelyVisible,
  isLayerEditable,
  linkedSet,
  maskFromSelection,
  maskHideAll,
  maskRevealAll,
  mergeDown,
  opById,
  patternFill,
  rasterizeLayer,
  rectPath,
  removeMatte,
  rgba,
  solidFill,
  textSpec,
  type Document,
  type RasterLayer,
} from "../../lib/engine";

const W = 8;
const H = 6;

function px(r: Raster, x: number, y: number): [number, number, number, number] {
  const p = r.getPixel(x, y);
  return [p.r, p.g, p.b, p.a];
}

/** Gray mask raster: left half 255, right half 0. */
function halfMask(w: number, h: number, splitX = w / 2): Raster {
  const m = new Raster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.setPixel(x, y, x < splitX ? rgba(255, 255, 255) : rgba(0, 0, 0));
  return m;
}

function whiteDoc(): Document {
  return createDocument({ width: W, height: H, background: "white" });
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

describe("layer masks", () => {
  it("multiply the layer alpha by the mask's red channel", () => {
    const doc = whiteDoc();
    const red = createRasterLayer(doc, { name: "red", raster: Raster.filled(W, H, rgba(255, 0, 0)) });
    red.mask = halfMask(W, H);
    addLayer(doc, red);
    const out = compositeToRaster(doc);
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 6, 1)).toEqual([255, 255, 255, 255]);
  });

  it("soft mask values give partial coverage", () => {
    const doc = whiteDoc();
    const black = createRasterLayer(doc, { name: "b", raster: Raster.filled(W, H, rgba(0, 0, 0)) });
    black.mask = Raster.filled(W, H, rgba(128, 128, 128));
    addLayer(doc, black);
    const v = px(compositeToRaster(doc), 0, 0)[0];
    expect(Math.abs(v - 127)).toBeLessThanOrEqual(1);
  });

  it("maskEnabled = false ignores the mask but keeps it", () => {
    const doc = whiteDoc();
    const red = createRasterLayer(doc, { name: "red", raster: Raster.filled(W, H, rgba(255, 0, 0)) });
    red.mask = halfMask(W, H);
    red.maskEnabled = false;
    addLayer(doc, red);
    expect(px(compositeToRaster(doc), 6, 1)).toEqual([255, 0, 0, 255]);
    expect(red.mask).not.toBeNull();
  });

  it("mask factories: reveal all / hide all / from selection (reveal and hide)", () => {
    const doc = whiteDoc();
    const l = doc.layers[0]!;
    expect(maskRevealAll(doc, l).getPixel(0, 0).r).toBe(255);
    expect(maskHideAll(doc, l).getPixel(0, 0).r).toBe(0);
    doc.selection = Selection.fromRect(W, H, Rect.make(0, 0, 4, H));
    const reveal = maskFromSelection(doc, l, true);
    expect(reveal.getPixel(1, 1).r).toBe(255);
    expect(reveal.getPixel(6, 1).r).toBe(0);
    const hide = maskFromSelection(doc, l, false);
    expect(hide.getPixel(1, 1).r).toBe(0);
    expect(hide.getPixel(6, 1).r).toBe(255);
    // Offset layers sample the selection in document space.
    const off = createRasterLayer(doc, { raster: new Raster(2, 2), offset: { x: 5, y: 0 } });
    expect(maskFromSelection(doc, off, true).getPixel(0, 0).r).toBe(0);
  });

  it("SetLayerMask / SetMaskEnabled / ApplyMask commands undo and redo", () => {
    const doc = whiteDoc();
    const red = createRasterLayer(doc, { name: "red", raster: Raster.filled(W, H, rgba(255, 0, 0)) });
    addLayer(doc, red);
    const h = new History(doc);
    h.push(new SetLayerMaskCommand(red.id, halfMask(W, H)));
    expect(px(compositeToRaster(doc), 6, 1)).toEqual([255, 255, 255, 255]);
    h.push(new SetMaskEnabledCommand(red.id, false));
    expect(px(compositeToRaster(doc), 6, 1)).toEqual([255, 0, 0, 255]);
    h.undo();
    expect(red.maskEnabled).toBe(true);
    h.push(new ApplyMaskCommand(red.id));
    expect(red.mask).toBeNull();
    expect(red.raster.getPixel(6, 1).a).toBe(0);
    expect(red.raster.getPixel(1, 1).a).toBe(255);
    h.undo();
    expect(red.mask).not.toBeNull();
    expect(red.raster.getPixel(6, 1).a).toBe(255);
    h.undo();
    expect(red.mask).toBeNull();
    h.redo();
    h.redo();
    expect(red.mask).toBeNull();
    expect(red.raster.getPixel(6, 1).a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Clipping masks
// ---------------------------------------------------------------------------

describe("clipping masks", () => {
  function clipDoc(): { doc: Document; base: RasterLayer; clipped: RasterLayer } {
    const doc = whiteDoc();
    // Base: opaque blue only in the left half.
    const base = createRasterLayer(doc, { name: "base" });
    base.raster.fill(rgba(0, 0, 255), Rect.make(0, 0, 4, H));
    addLayer(doc, base);
    const clipped = createRasterLayer(doc, { name: "clipped", raster: Raster.filled(W, H, rgba(0, 255, 0)), clipToBelow: true });
    addLayer(doc, clipped);
    return { doc, base, clipped };
  }

  it("clipped layer only shows where the base has alpha", () => {
    const { doc } = clipDoc();
    const out = compositeToRaster(doc);
    expect(px(out, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(out, 6, 1)).toEqual([255, 255, 255, 255]);
  });

  it("soft base alpha clips proportionally", () => {
    const { doc, base } = clipDoc();
    base.raster.fill(rgba(0, 0, 255, 128), Rect.make(0, 0, 4, H));
    const p = px(compositeToRaster(doc), 1, 1);
    // green at ~50% clipped over blue(50%), then the unit (75% alpha) over white
    expect(p[1]).toBeGreaterThan(180);
    expect(p[2]).toBeGreaterThan(100);
    expect(p[2]).toBeLessThan(200);
  });

  it("blends the unit with the base's blend mode and opacity (Blend Clipped Layers as Group)", () => {
    const { doc, base } = clipDoc();
    base.blendMode = BlendMode.Multiply;
    base.opacity = 0.5;
    (doc.layers[0] as RasterLayer).raster.fill(rgba(255, 0, 0)); // red backdrop
    const p = px(compositeToRaster(doc), 1, 1);
    // unit = green; multiply with red = black; at 50% over red → (127,0,0)
    expect(p[0]).toBeGreaterThan(120);
    expect(p[0]).toBeLessThan(135);
    expect(p[1]).toBe(0);
  });

  it("hidden base hides the whole chain; queries find base and chain", () => {
    const { doc, base, clipped } = clipDoc();
    expect(clipBaseOf(doc, clipped.id)?.id).toBe(base.id);
    expect(clippedLayersOf(doc, base.id).map((l) => l.id)).toEqual([clipped.id]);
    expect(isEffectivelyVisible(doc, clipped)).toBe(true);
    base.visible = false;
    expect(isEffectivelyVisible(doc, clipped)).toBe(false);
    expect(px(compositeToRaster(doc), 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it("SetClipToBelowCommand toggles and undoes; releasing shows the layer everywhere", () => {
    const { doc, clipped } = clipDoc();
    const h = new History(doc);
    h.push(new SetClipToBelowCommand(clipped.id, false));
    expect(px(compositeToRaster(doc), 6, 1)).toEqual([0, 255, 0, 255]);
    h.undo();
    expect(clipped.clipToBelow).toBe(true);
    expect(px(compositeToRaster(doc), 6, 1)).toEqual([255, 255, 255, 255]);
  });

  it("the clipped layer's own mask and the base's mask both apply", () => {
    const { doc, base, clipped } = clipDoc();
    clipped.mask = halfMask(W, H, 2); // clipped visible only x<2
    base.mask = halfMask(W, H, 3);
    const out = compositeToRaster(doc);
    expect(px(out, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(out, 2, 1)).toEqual([0, 0, 255, 255]);
    expect(px(out, 3, 1)).toEqual([255, 255, 255, 255]);
  });

  it("merge down bakes a clipped layer into its base", () => {
    const { doc, base, clipped } = clipDoc();
    const merged = mergeDown(doc, clipped.id);
    expect(merged.id).toBe(base.id);
    expect(doc.layers).toHaveLength(2);
    expect(merged.raster.getPixel(1, 1)).toEqual(rgba(0, 255, 0));
    expect(merged.raster.getPixel(6, 1).a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Adjustment layers
// ---------------------------------------------------------------------------

describe("adjustment layers", () => {
  it("produce the same pixels as the destructive op", () => {
    const doc = createDocument({ width: W, height: H, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg" });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bg.raster.setPixel(x, y, rgba(x * 30, y * 40, 200, 255));
    addLayer(doc, bg);
    const adj = createAdjustmentLayer(doc, { op: "invert" });
    addLayer(doc, adj);
    const out = compositeToRaster(doc);
    const direct = opById("invert")!.cpu(bg.raster, {});
    expect(out.equals(direct)).toBe(true);
    const hs = createAdjustmentLayer(doc, { op: "hue-saturation", params: { saturation: -100 } });
    doc.layers = [bg, hs];
    const out2 = compositeToRaster(doc);
    const direct2 = opById("hue-saturation")!.cpu(bg.raster, hs.params);
    expect(out2.equals(direct2)).toBe(true);
  });

  it("keeps the alpha of the layers below and respects opacity and mask", () => {
    const doc = createDocument({ width: W, height: H, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg" });
    bg.raster.fill(rgba(0, 0, 0, 128), Rect.make(0, 0, 4, H));
    addLayer(doc, bg);
    const adj = createAdjustmentLayer(doc, { op: "invert", opacity: 0.5 });
    addLayer(doc, adj);
    let out = compositeToRaster(doc);
    expect(out.getPixel(1, 1).a).toBe(128);
    expect(out.getPixel(6, 1).a).toBe(0);
    expect(Math.abs(out.getPixel(1, 1).r - 127)).toBeLessThanOrEqual(1);
    adj.opacity = 1;
    adj.mask = halfMask(W, H, 2);
    out = compositeToRaster(doc);
    expect(out.getPixel(1, 1).r).toBe(255);
    expect(out.getPixel(3, 1).r).toBe(0);
  });

  it("a clipped adjustment affects only its base, an unclipped one everything below", () => {
    const doc = createDocument({ width: W, height: H, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg", raster: Raster.filled(W, H, rgba(0, 0, 0)) });
    addLayer(doc, bg);
    const base = createRasterLayer(doc, { name: "base" });
    base.raster.fill(rgba(0, 0, 0), Rect.make(0, 0, 4, H));
    addLayer(doc, base);
    const adj = createAdjustmentLayer(doc, { op: "invert", clipToBelow: true });
    addLayer(doc, adj);
    let out = compositeToRaster(doc);
    expect(out.getPixel(1, 1).r).toBe(255); // base inverted
    expect(out.getPixel(6, 1).r).toBe(0); // bg untouched
    adj.clipToBelow = false;
    out = compositeToRaster(doc);
    expect(out.getPixel(6, 1).r).toBe(255);
  });

  it("inside an isolated group only affects the group; in a pass-through group everything below", () => {
    const doc = createDocument({ width: W, height: H, noBackgroundLayer: true });
    const bg = createRasterLayer(doc, { name: "bg", raster: Raster.filled(W, H, rgba(0, 0, 0)) });
    addLayer(doc, bg);
    const member = createRasterLayer(doc, { name: "m" });
    member.raster.fill(rgba(0, 0, 0), Rect.make(0, 0, 4, H));
    addLayer(doc, member);
    const g = groupLayers(doc, [member.id]);
    const adj = createAdjustmentLayer(doc, { op: "invert", parentId: g.id });
    doc.layers.push(adj);
    g.passThrough = true;
    let out = compositeToRaster(doc);
    expect(out.getPixel(6, 1).r).toBe(255);
    g.passThrough = false;
    out = compositeToRaster(doc);
    expect(out.getPixel(1, 1).r).toBe(255);
    expect(out.getPixel(6, 1).r).toBe(0);
  });

  it("SetAdjustmentParamsCommand merges ticks and undoes", () => {
    const doc = whiteDoc();
    const adj = createAdjustmentLayer(doc, { op: "brightness-contrast" });
    addLayer(doc, adj);
    const h = new History(doc);
    h.push(new SetAdjustmentParamsCommand(adj.id, { brightness: -50 }));
    h.push(new SetAdjustmentParamsCommand(adj.id, { brightness: -100 }));
    expect(h.entries).toHaveLength(1);
    expect(adj.params.brightness).toBe(-100);
    expect(compositeToRaster(doc).getPixel(0, 0).r).toBe(155);
    h.undo();
    expect(adj.params.brightness).toBe(0);
    expect(compositeToRaster(doc).getPixel(0, 0).r).toBe(255);
  });

  it("unknown op ids render as a no-op", () => {
    const doc = whiteDoc();
    addLayer(doc, createAdjustmentLayer(doc, { op: "does-not-exist" }));
    expect(px(compositeToRaster(doc), 0, 0)).toEqual([255, 255, 255, 255]);
  });
});

// ---------------------------------------------------------------------------
// Fill layers
// ---------------------------------------------------------------------------

describe("fill layers", () => {
  it("solid fill covers the canvas and honours opacity / mask", () => {
    const doc = whiteDoc();
    const f = createFillLayer(doc, { fill: solidFill(rgba(0, 0, 255)), opacity: 0.5 });
    f.mask = halfMask(W, H);
    addLayer(doc, f);
    const out = compositeToRaster(doc);
    expect(px(out, 1, 1)[2]).toBe(255);
    expect(Math.abs(px(out, 1, 1)[0] - 127)).toBeLessThanOrEqual(1);
    expect(px(out, 6, 1)).toEqual([255, 255, 255, 255]);
  });

  it("gradient fill ramps across the canvas (PS angle 0 = left to right)", () => {
    const doc = createDocument({ width: 16, height: 4, noBackgroundLayer: true });
    addLayer(doc, createFillLayer(doc, { fill: gradientFill([{ pos: 0, color: rgba(0, 0, 0) }, { pos: 1, color: rgba(255, 255, 255) }], { angle: 0 }) }));
    const out = compositeToRaster(doc);
    const a = out.getPixel(0, 0).r;
    const b = out.getPixel(8, 0).r;
    const c = out.getPixel(15, 0).r;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(Math.abs(b - 128)).toBeLessThanOrEqual(12);
  });

  it("pattern fill tiles the raster with scale and offset", () => {
    const doc = createDocument({ width: 8, height: 4, noBackgroundLayer: true });
    const tile = new Raster(2, 2);
    tile.setPixel(0, 0, rgba(255, 0, 0));
    tile.setPixel(1, 0, rgba(0, 255, 0));
    tile.setPixel(0, 1, rgba(0, 0, 255));
    tile.setPixel(1, 1, rgba(255, 255, 0));
    const f = createFillLayer(doc, { fill: patternFill(tile) });
    addLayer(doc, f);
    let out = compositeToRaster(doc);
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 3, 1)).toEqual([255, 255, 0, 255]);
    const h = new History(doc);
    h.push(new SetFillLayerCommand(f.id, patternFill(tile, { scale: 2 })));
    out = compositeToRaster(doc);
    expect(px(out, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2, 0)).toEqual([0, 255, 0, 255]);
    h.push(new SetFillLayerCommand(f.id, patternFill(tile, { offset: { x: 1, y: 0 } })));
    out = compositeToRaster(doc);
    expect(px(out, 1, 0)).toEqual([255, 0, 0, 255]);
    h.undo();
    h.undo();
    expect(px(compositeToRaster(doc), 1, 0)).toEqual([0, 255, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

describe("groups: pass-through vs isolated", () => {
  function groupDoc(): { doc: Document; g: ReturnType<typeof groupLayers> } {
    const doc = createDocument({ width: W, height: H, noBackgroundLayer: true });
    addLayer(doc, createRasterLayer(doc, { name: "bg", raster: Raster.filled(W, H, rgba(255, 0, 0)) }));
    const child = createRasterLayer(doc, { name: "mul", raster: Raster.filled(W, H, rgba(0, 255, 255)), blendMode: BlendMode.Multiply });
    addLayer(doc, child);
    const g = groupLayers(doc, [child.id]);
    return { doc, g };
  }

  it("pass-through (default): a multiply child blends with the backdrop", () => {
    const { doc, g } = groupDoc();
    expect(g.passThrough).toBe(true);
    expect(px(compositeToRaster(doc), 1, 1)).toEqual([0, 0, 0, 255]);
  });

  it("isolated: the child blends against transparent, then the group blends Normal", () => {
    const { doc, g } = groupDoc();
    g.passThrough = false;
    expect(px(compositeToRaster(doc), 1, 1)).toEqual([0, 255, 255, 255]);
  });

  it("pass-through group opacity lerps the whole group result; isolated opacity blends", () => {
    const { doc, g } = groupDoc();
    g.opacity = 0.5;
    const p = px(compositeToRaster(doc), 1, 1);
    expect(Math.abs(p[0] - 127)).toBeLessThanOrEqual(1);
    expect(p[1]).toBe(0);
    g.passThrough = false;
    const q = px(compositeToRaster(doc), 1, 1);
    expect(Math.abs(q[0] - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs(q[1] - 127)).toBeLessThanOrEqual(1);
  });

  it("group mask limits a pass-through group", () => {
    const { doc, g } = groupDoc();
    g.mask = halfMask(W, H);
    const out = compositeToRaster(doc);
    expect(px(out, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(px(out, 6, 1)).toEqual([255, 0, 0, 255]);
  });
});

// ---------------------------------------------------------------------------
// Fill opacity
// ---------------------------------------------------------------------------

describe("fill opacity", () => {
  it("scales the pixels but not the effects", () => {
    const doc = whiteDoc();
    const l = createRasterLayer(doc, { name: "box" });
    l.raster.fill(rgba(0, 0, 255), Rect.make(2, 2, 3, 2));
    l.effects = { stroke: defaultStroke({ size: 1, color: rgba(255, 0, 0), position: "outside" }) };
    addLayer(doc, l);
    const h = new History(doc);
    h.push(new SetFillOpacityCommand(l.id, 0));
    const out = compositeToRaster(doc);
    expect(px(out, 3, 3)).toEqual([255, 255, 255, 255]); // fill gone
    expect(px(out, 1, 3)).toEqual([255, 0, 0, 255]); // stroke stays
    h.push(new SetFillOpacityCommand(l.id, 0.5));
    expect(h.entries).toHaveLength(1); // merged ticks
    const half = px(compositeToRaster(doc), 3, 3);
    expect(Math.abs(half[0] - 127)).toBeLessThanOrEqual(2);
    expect(half[2]).toBe(255);
    h.undo();
    expect(l.fillOpacity).toBe(1);
  });

  it("without effects, fill opacity multiplies into opacity", () => {
    const doc = whiteDoc();
    const l = createRasterLayer(doc, { name: "b", raster: Raster.filled(W, H, rgba(0, 0, 0)), fillOpacity: 0.5, opacity: 0.5 });
    addLayer(doc, l);
    const v = px(compositeToRaster(doc), 0, 0)[0];
    expect(Math.abs(v - 191)).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Shape and text layers
// ---------------------------------------------------------------------------

describe("shape and text layers", () => {
  it("shape layer rasterizes fill and stroke and re-rasterizes on edit (undoable)", () => {
    const doc = createDocument({ width: 16, height: 16, noBackgroundLayer: true });
    const shape = createShapeLayer(doc, { path: rectPath(Rect.make(4, 4, 8, 8)), fill: solidFill(rgba(0, 0, 255)), stroke: null });
    addLayer(doc, shape);
    expect(px(compositeToRaster(doc), 8, 8)).toEqual([0, 0, 255, 255]);
    expect(px(compositeToRaster(doc), 1, 1)[3]).toBe(0);
    const h = new History(doc);
    h.push(new SetShapeLayerCommand(shape.id, { stroke: { width: 2, fill: solidFill(rgba(255, 0, 0)), position: "outside", cap: "butt", join: "miter", dash: null } }));
    const out = compositeToRaster(doc);
    expect(px(out, 3, 8)).toEqual([255, 0, 0, 255]); // outside stroke
    expect(px(out, 8, 8)).toEqual([0, 0, 255, 255]); // fill intact
    h.undo();
    expect(shape.stroke).toBeNull();
    expect(px(compositeToRaster(doc), 3, 8)[3]).toBe(0);
    h.push(new SetShapeLayerCommand(shape.id, { path: rectPath(Rect.make(0, 0, 4, 4)) }));
    expect(px(compositeToRaster(doc), 1, 1)).toEqual([0, 0, 255, 255]);
    expect(px(compositeToRaster(doc), 8, 8)[3]).toBe(0);
  });

  it("inside / center stroke positions", () => {
    const doc = createDocument({ width: 16, height: 16, noBackgroundLayer: true });
    const inside = createShapeLayer(doc, {
      path: rectPath(Rect.make(4, 4, 8, 8)),
      fill: solidFill(rgba(0, 0, 255)),
      stroke: { width: 2, fill: solidFill(rgba(255, 0, 0)), position: "inside", cap: "butt", join: "miter", dash: null },
    });
    expect(inside.raster.getPixel(3, 8).a).toBe(0);
    expect(inside.raster.getPixel(4, 8)).toEqual(rgba(255, 0, 0));
    expect(inside.raster.getPixel(8, 8)).toEqual(rgba(0, 0, 255));
    const center = createShapeLayer(doc, {
      path: rectPath(Rect.make(4, 4, 8, 8)),
      fill: solidFill(rgba(0, 0, 255)),
      stroke: { width: 2, fill: solidFill(rgba(255, 0, 0)), position: "center", cap: "butt", join: "miter", dash: null },
    });
    expect(center.raster.getPixel(3, 8)).toEqual(rgba(255, 0, 0));
    expect(center.raster.getPixel(4, 8)).toEqual(rgba(255, 0, 0));
    expect(center.raster.getPixel(2, 8).a).toBe(0);
  });

  it("text layer rasterizes at its origin and re-rasterizes through SetTextLayerCommand", () => {
    const doc = createDocument({ width: 64, height: 32, noBackgroundLayer: true });
    const t = createTextLayer(doc, { text: textSpec("AB", 4, 20, { size: 10, color: rgba(0, 0, 0) }) });
    addLayer(doc, t);
    expect(t.name).toBe("AB");
    const bb = t.raster.boundingBoxOfAlpha();
    expect(bb).not.toBeNull();
    expect(bb!.x).toBeGreaterThanOrEqual(4);
    expect(bb!.y + bb!.h).toBeLessThanOrEqual(21);
    const h = new History(doc);
    h.push(new SetTextLayerCommand(t.id, { x: 30 }));
    const bb2 = t.raster.boundingBoxOfAlpha()!;
    expect(bb2.x).toBeGreaterThanOrEqual(30);
    h.undo();
    expect(t.text.x).toBe(4);
    expect(t.raster.boundingBoxOfAlpha()!.x).toBe(bb!.x);
  });

  it("vertical text stacks glyphs and right alignment ends at x", () => {
    const doc = createDocument({ width: 64, height: 64, noBackgroundLayer: true });
    const v = createTextLayer(doc, { text: textSpec("AB", 32, 12, { size: 10, vertical: true }) });
    const bb = v.raster.boundingBoxOfAlpha()!;
    expect(bb.h).toBeGreaterThan(bb.w);
    const r = createTextLayer(doc, { text: textSpec("AB", 40, 20, { size: 10, align: "right" }) });
    const rb = r.raster.boundingBoxOfAlpha()!;
    expect(rb.x + rb.w).toBeLessThanOrEqual(41);
  });

  it("rasterizeLayer converts shape / text / fill into raster layers in place", () => {
    const doc = createDocument({ width: 8, height: 8, noBackgroundLayer: true });
    const shape = createShapeLayer(doc, { path: rectPath(Rect.make(0, 0, 4, 4)), fill: solidFill(rgba(1, 2, 3)) });
    addLayer(doc, shape);
    const fill = createFillLayer(doc, { fill: solidFill(rgba(9, 9, 9)) });
    addLayer(doc, fill);
    const r1 = rasterizeLayer(doc, shape.id);
    expect(r1.kind).toBe("raster");
    expect(r1.id).toBe(shape.id);
    expect(doc.layers[0]).toBe(r1);
    expect(r1.raster.getPixel(1, 1)).toEqual(rgba(1, 2, 3));
    const r2 = rasterizeLayer(doc, fill.id);
    expect(r2.raster.getPixel(7, 7)).toEqual(rgba(9, 9, 9));
    expect(() => rasterizeLayer(doc, createAdjustmentLayer(doc, { op: "invert" }).id)).toThrow();
  });

  it("duplicateLayer deep-copies every kind with the new fields", () => {
    const doc = createDocument({ width: 8, height: 8 });
    const shape = createShapeLayer(doc, { path: rectPath(Rect.make(0, 0, 4, 4)), fill: solidFill(rgba(1, 2, 3)), color: "red", fillOpacity: 0.5 });
    shape.mask = halfMask(8, 8);
    shape.effects = { stroke: defaultStroke() };
    addLayer(doc, shape);
    const [copy] = duplicateLayer(doc, shape.id);
    expect(copy!.kind).toBe("shape");
    expect(copy!.id).not.toBe(shape.id);
    expect(copy!.mask).not.toBe(shape.mask);
    expect(copy!.effects).not.toBe(shape.effects);
    expect(copy!.effects).toEqual(shape.effects);
    expect(copy!.color).toBe("red");
    expect(copy!.fillOpacity).toBe(0.5);
    if (copy!.kind === "shape") expect(copy!.path).not.toBe(shape.path);
    expect(documentByteSize(doc)).toBeGreaterThan(8 * 8 * 4 * 3);
  });
});

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

describe("locks", () => {
  it("isLayerEditable reflects the four toggles and the legacy flag", () => {
    const doc = whiteDoc();
    const l = doc.layers[0]!;
    expect(isLayerEditable(l, "pixels")).toBe(true);
    l.lock.pixels = true;
    expect(isLayerEditable(l, "pixels")).toBe(false);
    expect(isLayerEditable(l, "position")).toBe(true);
    l.lock.pixels = false;
    l.locked = true;
    expect(isLayerEditable(l, "pixels")).toBe(false);
    expect(isLayerEditable(l, "position")).toBe(false);
    expect(isLayerEditable(l, "structure")).toBe(false);
    expect(isLayerEditable(l, "props")).toBe(true);
  });

  it("pixel lock makes paint / replace commands throw LayerLockedError", () => {
    const doc = whiteDoc();
    const l = doc.layers[0] as RasterLayer;
    const h = new History(doc);
    h.push(new SetLayerLockCommand(l.id, { pixels: true }));
    expect(l.locked).toBe(false);
    expect(() => PaintCommand.capture(l)).toThrow(LayerLockedError);
    expect(() => h.push(ReplaceLayerPixelsCommand.whole("x", l, Raster.filled(W, H, rgba(0, 0, 0))))).toThrow(LayerLockedError);
    expect(l.raster.getPixel(0, 0).r).toBe(255);
    h.push(new SetLayerLockCommand(l.id, { all: true }));
    expect(l.locked).toBe(true);
    h.undo();
    expect(l.locked).toBe(false);
    expect(l.lock.pixels).toBe(true);
  });

  it("position lock refuses moves and transforms", () => {
    const doc = whiteDoc();
    const l = doc.layers[0] as RasterLayer;
    l.lock.position = true;
    const h = new History(doc);
    expect(() => h.push(new SetLayerPropsCommand(l.id, { offset: { x: 1, y: 0 } }))).toThrow(LayerLockedError);
    expect(() => h.push(new TransformLayerCommand(l.id, l.raster.flipH(), { x: 0, y: 0 }))).toThrow(LayerLockedError);
    expect(() => h.push(new MoveLayersCommand(doc, [l.id], 2, 0))).toThrow(LayerLockedError);
    expect(l.offset).toEqual({ x: 0, y: 0 });
    // Opacity still fine.
    h.push(new SetLayerPropsCommand(l.id, { opacity: 0.5 }));
    expect(l.opacity).toBe(0.5);
  });

  it("transparency lock keeps the original alpha for paint and replace commands", () => {
    const doc = createDocument({ width: 4, height: 1 });
    const l = doc.layers[0] as RasterLayer;
    l.raster.setPixel(0, 0, rgba(0, 0, 0, 255));
    l.raster.setPixel(1, 0, rgba(0, 0, 0, 128));
    l.lock.transparent = true;
    const cap = PaintCommand.capture(l);
    l.raster.fill(rgba(255, 0, 0, 255));
    const cmd = PaintCommand.finish(l, cap);
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(255, 0, 0, 255));
    expect(l.raster.getPixel(1, 0)).toEqual(rgba(255, 0, 0, 128));
    expect(l.raster.getPixel(3, 0).a).toBe(0);
    const h = new History(doc);
    h.push(cmd, { alreadyApplied: true });
    h.undo();
    expect(l.raster.getPixel(0, 0)).toEqual(rgba(0, 0, 0, 255));
    h.push(ReplaceLayerPixelsCommand.whole("fill", l, Raster.filled(4, 1, rgba(0, 255, 0, 255))));
    expect(l.raster.getPixel(1, 0)).toEqual(rgba(0, 255, 0, 128));
    expect(l.raster.getPixel(3, 0).a).toBe(0);
    const before = Raster.filled(2, 1, rgba(0, 0, 0, 0));
    const after = Raster.filled(2, 1, rgba(9, 9, 9, 255));
    expect(applyTransparencyLock(before, after).getPixel(0, 0)).toEqual(rgba(0, 0, 0, 0));
  });
});

// ---------------------------------------------------------------------------
// Linking, moving, colour, effects commands
// ---------------------------------------------------------------------------

describe("linking and moving", () => {
  it("LinkLayersCommand links symmetrically, MoveLayersCommand moves the set and merges", () => {
    const doc = whiteDoc();
    const a = createRasterLayer(doc, { name: "a" });
    const b = createRasterLayer(doc, { name: "b" });
    const c = createRasterLayer(doc, { name: "c" });
    addLayer(doc, a);
    addLayer(doc, b);
    addLayer(doc, c);
    const h = new History(doc);
    h.push(new LinkLayersCommand([a.id, b.id]));
    expect(a.linkedTo).toEqual([b.id]);
    expect(b.linkedTo).toEqual([a.id]);
    expect(linkedSet(doc, a.id).sort()).toEqual([a.id, b.id].sort());
    h.push(new MoveLayersCommand(doc, [a.id], 3, 2));
    h.push(new MoveLayersCommand(doc, [a.id], 1, 0));
    expect(h.entries).toHaveLength(2);
    expect(a.offset).toEqual({ x: 4, y: 2 });
    expect(b.offset).toEqual({ x: 4, y: 2 });
    expect(c.offset).toEqual({ x: 0, y: 0 });
    h.undo();
    expect(a.offset).toEqual({ x: 0, y: 0 });
    expect(b.offset).toEqual({ x: 0, y: 0 });
    h.push(new LinkLayersCommand([a.id], false));
    expect(a.linkedTo).toEqual([]);
    expect(b.linkedTo).toEqual([]);
    h.undo();
    expect(b.linkedTo).toEqual([a.id]);
  });

  it("an unlinked mask stays put in document space when the layer moves", () => {
    const doc = whiteDoc();
    const l = createRasterLayer(doc, { name: "l", raster: Raster.filled(W, H, rgba(0, 0, 0)) });
    l.mask = halfMask(W, H);
    l.maskLinked = false;
    addLayer(doc, l);
    const h = new History(doc);
    h.push(new MoveLayersCommand(doc, [l.id], 2, 0));
    expect(l.offset.x).toBe(2);
    const out = compositeToRaster(doc);
    // Layer now covers x>=2; mask (doc-space) reveals x<4 → black only at 2,3.
    expect(px(out, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(px(out, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(px(out, 4, 1)).toEqual([255, 255, 255, 255]);
    h.undo();
    expect(l.offset.x).toBe(0);
    expect(l.mask!.getPixel(3, 0).r).toBe(255);
  });

  it("SetLayerColorCommand / SetLayerEffectsCommand undo and merge", () => {
    const doc = whiteDoc();
    const l = doc.layers[0]!;
    const h = new History(doc);
    h.push(new SetLayerColorCommand(l.id, "violet"));
    expect(l.color).toBe("violet");
    h.undo();
    expect(l.color).toBeNull();
    h.push(new SetLayerEffectsCommand(l.id, { stroke: defaultStroke({ size: 2 }) }));
    h.push(new SetLayerEffectsCommand(l.id, { stroke: defaultStroke({ size: 4 }) }));
    expect(h.entries).toHaveLength(1); // the undone colour step was dropped; two effect ticks merged
    expect(l.effects?.stroke?.size).toBe(4);
    h.undo();
    expect(l.effects).toBeNull();
  });

  it("AddLayerCommand works for every kind and respects group membership", () => {
    const doc = whiteDoc();
    const h = new History(doc);
    h.push(new AddLayerCommand(createGroupLayer(doc, { name: "G" })));
    const g = doc.layers[1]!;
    const adj = createAdjustmentLayer(doc, { op: "invert", parentId: g.id });
    h.push(new AddLayerCommand(adj));
    expect(doc.layers[2]!.parentId).toBe(g.id);
    h.undo();
    h.undo();
    expect(doc.layers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Matting & colour range
// ---------------------------------------------------------------------------

describe("matting", () => {
  it("removeMatte undoes black / white contamination of semi-transparent pixels", () => {
    const r = new Raster(2, 1);
    // A pure red pixel at 50% composited on black stores (127,0,0,128)
    r.setPixel(0, 0, rgba(128, 0, 0, 128));
    r.setPixel(1, 0, rgba(255, 128, 128, 128)); // red on white
    const b = removeMatte(r, "black");
    expect(b.getPixel(0, 0).r).toBe(255);
    expect(b.getPixel(0, 0).a).toBe(128);
    const w = removeMatte(r, "white");
    expect(w.getPixel(1, 0).r).toBe(255);
    expect(w.getPixel(1, 0).g).toBeLessThanOrEqual(2);
    // Opaque pixels untouched.
    const o = Raster.filled(1, 1, rgba(10, 20, 30, 255));
    expect(removeMatte(o, "black").getPixel(0, 0)).toEqual(rgba(10, 20, 30, 255));
  });

  it("defringe replaces edge colours with interior colours", () => {
    const r = new Raster(5, 5);
    r.fill(rgba(0, 0, 255), Rect.make(1, 1, 3, 3));
    // Contaminated edge pixel.
    r.setPixel(1, 1, rgba(255, 255, 255, 255));
    r.setPixel(1, 2, rgba(200, 200, 200, 200));
    const d = defringe(r, 1);
    expect(d.getPixel(1, 1).b).toBe(255);
    expect(d.getPixel(1, 1).r).toBe(0);
    expect(d.getPixel(1, 2).a).toBe(200);
    expect(d.getPixel(1, 2).b).toBe(255);
    expect(d.getPixel(2, 2)).toEqual(rgba(0, 0, 255));
  });
});

describe("Selection.fromColorRange", () => {
  it("selects by fuzziness with soft falloff and supports invert", () => {
    const r = new Raster(4, 1);
    r.setPixel(0, 0, rgba(255, 0, 0));
    r.setPixel(1, 0, rgba(235, 0, 0));
    r.setPixel(2, 0, rgba(0, 0, 255));
    r.setPixel(3, 0, rgba(0, 0, 0, 0));
    const s = Selection.fromColorRange(r, [rgba(255, 0, 0)], 40);
    expect(s.get(0, 0)).toBe(255);
    expect(s.get(1, 0)).toBe(128);
    expect(s.get(2, 0)).toBe(0);
    expect(s.get(3, 0)).toBe(0);
    const exact = Selection.fromColorRange(r, [rgba(255, 0, 0)], 0);
    expect(exact.get(1, 0)).toBe(0);
    const inv = Selection.fromColorRange(r, [rgba(255, 0, 0)], 40, { invert: true });
    expect(inv.get(0, 0)).toBe(0);
    expect(inv.get(2, 0)).toBe(255);
    const multi = Selection.fromColorRange(r, [rgba(255, 0, 0), rgba(0, 0, 255)], 10);
    expect(multi.get(2, 0)).toBe(255);
  });
});
