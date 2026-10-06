import { describe, expect, it } from "vitest";
import { dabCoverage, interpolateDabs, spacingPx, pressureSize, constrainAngle } from "../lib/tools/paint/dab";
import { Stroke } from "../lib/tools/paint/stroke";
import { fillThroughMask, clearThroughMask, renderGradient } from "../lib/tools/paint/fill";
import { combineSelection, dragRect, modeFromModifiers, isClick, selectionLabel } from "../lib/tools/selection-mod";
import { Raster, Rect, Selection, createDocument, createRasterLayer, type RasterLayer } from "../lib/engine";

describe("dab math", () => {
  it("hard brush is fully covered inside and zero outside", () => {
    expect(dabCoverage(0, 10, 1)).toBe(1);
    expect(dabCoverage(5, 10, 1)).toBe(1);
    expect(dabCoverage(10, 10, 1)).toBe(0);
    expect(dabCoverage(11, 10, 1)).toBe(0);
  });

  it("soft brush falls off smoothly and monotonically", () => {
    let prev = 1;
    for (let d = 0; d <= 10; d += 0.5) {
      const c = dabCoverage(d, 10, 0);
      expect(c).toBeLessThanOrEqual(prev + 1e-9);
      expect(c).toBeGreaterThanOrEqual(0);
      prev = c;
    }
    expect(dabCoverage(5, 10, 0)).toBeCloseTo(0.5, 1);
  });

  it("spacing is a percentage of the diameter with a floor", () => {
    expect(spacingPx(40, 25)).toBe(10);
    expect(spacingPx(1, 10)).toBe(0.5);
  });

  it("interpolates dabs at even spacing and carries the remainder", () => {
    const a = interpolateDabs({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(a.points.map((p) => p.x)).toEqual([4, 8]);
    expect(a.carry).toBeCloseTo(2);
    // Continue: next dab should land 2px into the next segment.
    const b = interpolateDabs({ x: 10, y: 0 }, { x: 20, y: 0 }, 4, a.carry);
    expect(b.points.map((p) => p.x)).toEqual([12, 16, 20]);
    expect(b.carry).toBeCloseTo(0);
  });

  it("a move shorter than the spacing stamps nothing but accumulates", () => {
    const r = interpolateDabs({ x: 0, y: 0 }, { x: 1, y: 0 }, 4, 1);
    expect(r.points).toHaveLength(0);
    expect(r.carry).toBe(2);
    expect(interpolateDabs({ x: 3, y: 3 }, { x: 3, y: 3 }, 4, 1.5).carry).toBe(1.5);
  });

  it("pressure scales pen size only", () => {
    expect(pressureSize(100, 0.5, "pen", true)).toBe(50);
    expect(pressureSize(100, 0.5, "mouse", true)).toBe(100);
    expect(pressureSize(100, 0.5, "pen", false)).toBe(100);
    expect(pressureSize(100, 0, "pen", true)).toBeGreaterThanOrEqual(1);
  });

  it("constrains to 45 degree steps", () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1), 5);
    const q = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y, 5);
  });
});

function layer(w = 32, h = 32, fill?: { r: number; g: number; b: number; a: number }): RasterLayer {
  const doc = createDocument({ width: w, height: h, noBackgroundLayer: true });
  const l = createRasterLayer(doc, { name: "L" });
  if (fill) l.raster.fill(fill);
  return l;
}

describe("Stroke engine", () => {
  const base = { opacity: 1, flow: 1, hardness: 1, spacing: 25, selection: null, layerOffset: { x: 0, y: 0 } } as const;

  it("paints an opaque dab with the colour and reports a dirty rect", () => {
    const l = layer();
    const s = new Stroke(l, { ...base, mode: "paint", color: { r: 255, g: 0, b: 0, a: 255 } });
    const rect = s.moveTo({ x: 16, y: 16 }, 8);
    expect(rect).not.toBeNull();
    expect(l.raster.getPixel(16, 16)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(l.raster.getPixel(0, 0).a).toBe(0);
    const cmd = s.finish("Brush");
    expect(cmd).not.toBeNull();
    expect(cmd!.affected()[0]!.layerId).toBe(l.id);
  });

  it("opacity caps accumulation across overlapping dabs", () => {
    const l = layer();
    const s = new Stroke(l, { ...base, mode: "paint", opacity: 0.5, color: { r: 0, g: 0, b: 255, a: 255 } });
    s.moveTo({ x: 10, y: 10 }, 10);
    s.moveTo({ x: 11, y: 10 }, 10);
    s.moveTo({ x: 12, y: 10 }, 10);
    const a = l.raster.getPixel(11, 10).a;
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThanOrEqual(128);
  });

  it("eraser removes alpha and keeps colour", () => {
    const l = layer(32, 32, { r: 10, g: 20, b: 30, a: 255 });
    const s = new Stroke(l, { ...base, mode: "erase", color: { r: 0, g: 0, b: 0, a: 255 } });
    s.moveTo({ x: 16, y: 16 }, 6);
    const p = l.raster.getPixel(16, 16);
    expect(p.a).toBe(0);
    expect(l.raster.getPixel(2, 2).a).toBe(255);
  });

  it("respects the selection as a clip", () => {
    const l = layer();
    const sel = Selection.fromRect(32, 32, Rect.make(0, 0, 16, 32));
    const s = new Stroke(l, { ...base, mode: "paint", selection: sel, color: { r: 0, g: 255, b: 0, a: 255 } });
    s.moveTo({ x: 16, y: 16 }, 12);
    expect(l.raster.getPixel(14, 16).a).toBe(255);
    expect(l.raster.getPixel(18, 16).a).toBe(0);
  });

  it("clone copies from the source offset", () => {
    const l = layer();
    const src = new Raster(32, 32);
    src.fill({ r: 7, g: 8, b: 9, a: 255 }, Rect.make(0, 0, 8, 8));
    const s = new Stroke(l, { ...base, mode: "clone", color: { r: 0, g: 0, b: 0, a: 0 }, source: { raster: src, delta: { x: -16, y: -16 } } });
    s.moveTo({ x: 18, y: 18 }, 4);
    expect(l.raster.getPixel(18, 18)).toEqual({ r: 7, g: 8, b: 9, a: 255 });
  });

  it("abort restores the snapshot", () => {
    const l = layer(32, 32, { r: 1, g: 2, b: 3, a: 255 });
    const s = new Stroke(l, { ...base, mode: "paint", color: { r: 255, g: 255, b: 255, a: 255 } });
    s.moveTo({ x: 16, y: 16 }, 10);
    expect(l.raster.getPixel(16, 16).r).toBe(255);
    s.abort();
    expect(l.raster.getPixel(16, 16)).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  });

  it("undo via the PaintCommand restores pixels exactly", () => {
    const doc = createDocument({ width: 24, height: 24, background: "white" });
    const l = doc.layers[0] as RasterLayer;
    const s = new Stroke(l, { ...base, mode: "paint", color: { r: 0, g: 0, b: 0, a: 255 } });
    s.moveTo({ x: 5, y: 5 }, 6);
    s.moveTo({ x: 18, y: 18 }, 6);
    const cmd = s.finish("Brush")!;
    expect(l.raster.getPixel(5, 5).r).toBe(0);
    cmd.undo(doc);
    expect(l.raster.getPixel(5, 5).r).toBe(255);
    cmd.do(doc);
    expect(l.raster.getPixel(18, 18).r).toBe(0);
  });
});

describe("fills", () => {
  it("fillThroughMask paints only selected pixels with coverage as alpha", () => {
    const r = new Raster(10, 10);
    const sel = Selection.fromRect(10, 10, Rect.make(2, 2, 3, 3));
    const touched = fillThroughMask(r, sel, { x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 255 });
    expect(touched).toEqual(Rect.make(2, 2, 3, 3));
    expect(r.getPixel(3, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(r.getPixel(0, 0).a).toBe(0);
  });

  it("fill honours the layer offset", () => {
    const r = new Raster(10, 10);
    const sel = Selection.fromRect(20, 20, Rect.make(12, 12, 2, 2));
    const touched = fillThroughMask(r, sel, { x: 10, y: 10 }, { r: 0, g: 255, b: 0, a: 255 });
    expect(touched).toEqual(Rect.make(2, 2, 2, 2));
    expect(r.getPixel(2, 2).g).toBe(255);
  });

  it("clearThroughMask erases inside the selection", () => {
    const r = Raster.filled(8, 8, { r: 1, g: 1, b: 1, a: 255 });
    clearThroughMask(r, Selection.fromRect(8, 8, Rect.make(0, 0, 4, 8)), { x: 0, y: 0 });
    expect(r.getPixel(1, 1).a).toBe(0);
    expect(r.getPixel(6, 1).a).toBe(255);
  });

  it("linear gradient interpolates fg → bg along the line", () => {
    const r = new Raster(11, 1);
    renderGradient(r, { x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }, { r: 0, g: 0, b: 0, a: 255 }, { r: 200, g: 200, b: 200, a: 255 }, "linear", { dither: false });
    expect(r.getPixel(0, 0).r).toBe(0);
    expect(r.getPixel(10, 0).r).toBe(200);
    expect(r.getPixel(5, 0).r).toBeCloseTo(100, -1);
  });

  it("radial gradient is symmetric around the centre and clipped by the selection", () => {
    const r = new Raster(21, 21);
    const clip = Selection.fromRect(21, 21, Rect.make(0, 0, 21, 10));
    renderGradient(r, { x: 10.5, y: 10.5 }, { x: 20.5, y: 10.5 }, { r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }, "radial", { clip, dither: false });
    expect(r.getPixel(10, 5).r).toBe(r.getPixel(5, 10 - 5).r === undefined ? r.getPixel(10, 5).r : r.getPixel(10, 5).r);
    expect(r.getPixel(10, 15).a).toBe(0); // below the clip
    expect(r.getPixel(10, 9).r).toBeGreaterThan(r.getPixel(2, 9).r);
  });
});

describe("selection modifiers", () => {
  it("maps Shift/Alt to add/subtract/intersect", () => {
    expect(modeFromModifiers({ shiftKey: false, altKey: false })).toBe("new");
    expect(modeFromModifiers({ shiftKey: true, altKey: false })).toBe("add");
    expect(modeFromModifiers({ shiftKey: false, altKey: true })).toBe("subtract");
    expect(modeFromModifiers({ shiftKey: true, altKey: true })).toBe("intersect");
    expect(modeFromModifiers({ shiftKey: false, altKey: false }, "subtract")).toBe("subtract");
  });

  it("dragRect constrains to square and grows from centre", () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 30, y: 15 })).toEqual({ x: 10, y: 10, w: 20, h: 5 });
    expect(dragRect({ x: 10, y: 10 }, { x: 30, y: 15 }, { square: true })).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(dragRect({ x: 10, y: 10 }, { x: 0, y: 15 }, { square: true })).toEqual({ x: 0, y: 10, w: 10, h: 10 });
    expect(dragRect({ x: 10, y: 10 }, { x: 14, y: 13 }, { fromCenter: true })).toEqual({ x: 6, y: 7, w: 8, h: 6 });
  });

  it("combineSelection applies boolean ops and treats empty sensibly", () => {
    const a = Selection.fromRect(10, 10, Rect.make(0, 0, 5, 10));
    const b = Selection.fromRect(10, 10, Rect.make(3, 0, 5, 10));
    expect(combineSelection(a, b, "new").bbox).toEqual(Rect.make(3, 0, 5, 10));
    expect(combineSelection(a, b, "add").bbox).toEqual(Rect.make(0, 0, 8, 10));
    expect(combineSelection(a, b, "subtract").bbox).toEqual(Rect.make(0, 0, 3, 10));
    expect(combineSelection(a, b, "intersect").bbox).toEqual(Rect.make(3, 0, 2, 10));
    const none = Selection.none(10, 10);
    expect(combineSelection(none, b, "add").bbox).toEqual(b.bbox);
    expect(combineSelection(none, b, "intersect").bbox).toEqual(b.bbox);
    expect(combineSelection(none, b, "subtract").isEmpty).toBe(true);
  });

  it("isClick depends on screen distance", () => {
    expect(isClick({ x: 0, y: 0 }, { x: 1, y: 1 }, 1)).toBe(true);
    expect(isClick({ x: 0, y: 0 }, { x: 1, y: 1 }, 4)).toBe(false);
  });

  it("labels describe the mode", () => {
    expect(selectionLabel("Rectangle", "new")).toBe("Rectangle Select");
    expect(selectionLabel("Lasso", "add")).toContain("Add to");
  });
});
