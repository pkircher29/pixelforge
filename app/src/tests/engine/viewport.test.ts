import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, Viewport, ZOOM_STEPS, clampZoom, formatZoom, nextZoomStep, prevZoomStep } from "../../lib/engine";

describe("zoom step table", () => {
  it("is ascending and Photoshop-like", () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) expect(ZOOM_STEPS[i]!).toBeGreaterThan(ZOOM_STEPS[i - 1]!);
    expect(ZOOM_STEPS).toContain(1);
    expect(ZOOM_STEPS).toContain(0.5);
    expect(ZOOM_STEPS).toContain(32);
    expect(ZOOM_STEPS[0]).toBe(0.01);
    expect(nextZoomStep(1)).toBe(2);
    expect(nextZoomStep(0.3)).toBeCloseTo(0.3333, 4);
    expect(prevZoomStep(1)).toBeCloseTo(0.6667, 4);
    expect(prevZoomStep(1.5)).toBe(1);
    expect(nextZoomStep(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(prevZoomStep(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(1);
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.6667)).toBe("66.7%");
    expect(formatZoom(0.0625)).toBe("6.25%");
  });
});

describe("Viewport transforms", () => {
  it("screen <-> doc round-trips with zoom, pan and rotation", () => {
    const v = new Viewport({ zoom: 2.5, panX: 100, panY: -40, rotation: 0.7 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 123.4, y: 56.7 },
      { x: -50, y: 900 },
    ]) {
      const s = v.docToScreen(p);
      const back = v.screenToDoc(s);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
    const v0 = new Viewport({ zoom: 2, panX: 10, panY: 20 });
    expect(v0.docToScreen({ x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
  });

  it("zoomAt keeps the document point under the cursor fixed", () => {
    const v = new Viewport({ zoom: 1, panX: 30, panY: 30, rotation: 0.2 });
    const cursor = { x: 200, y: 150 };
    const before = v.screenToDoc(cursor);
    v.zoomAt(cursor, 2);
    expect(v.zoom).toBe(2);
    const after = v.screenToDoc(cursor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    v.zoomIn(cursor);
    expect(v.zoom).toBe(3);
    v.zoomOut(cursor);
    v.zoomOut(cursor);
    expect(v.zoom).toBe(1);
    expect(v.screenToDoc(cursor).x).toBeCloseTo(before.x, 6);
  });

  it("fitToView centres the document and resets rotation", () => {
    const v = new Viewport({ rotation: 1 });
    v.fitToView(1000, 500, 200, 200, 50);
    expect(v.rotation).toBe(0);
    expect(v.zoom).toBe(2);
    expect(v.docToScreen({ x: 100, y: 100 })).toEqual({ x: 500, y: 250 });
    v.actualPixels(1000, 500, 200, 200);
    expect(v.zoom).toBe(1);
    expect(v.panX).toBe(400);
    v.centerOn({ x: 0, y: 0 }, 1000, 500);
    expect(v.docToScreen({ x: 0, y: 0 })).toEqual({ x: 500, y: 250 });
  });

  it("matrix and inverseMatrix agree with the point functions", () => {
    const v = new Viewport({ zoom: 1.5, panX: 12, panY: 34, rotation: -0.4 });
    const m = v.matrix(new Float32Array(9), 2);
    const inv = v.inverseMatrix(new Float32Array(9), 2);
    const p = { x: 40, y: 70 };
    const s = v.docToScreen(p);
    // column-major 3x3 applied to (x, y, 1), with DPR 2
    const sx = m[0]! * p.x + m[3]! * p.y + m[6]!;
    const sy = m[1]! * p.x + m[4]! * p.y + m[7]!;
    expect(sx).toBeCloseTo(s.x * 2, 4);
    expect(sy).toBeCloseTo(s.y * 2, 4);
    const dx = inv[0]! * sx + inv[3]! * sy + inv[6]!;
    const dy = inv[1]! * sx + inv[4]! * sy + inv[7]!;
    expect(dx).toBeCloseTo(p.x, 4);
    expect(dy).toBeCloseTo(p.y, 4);
  });

  it("rotateAt pivots around the screen point; clone/equals/toState", () => {
    const v = new Viewport({ zoom: 2, panX: 5, panY: 5 });
    const pivot = { x: 100, y: 100 };
    const docPivot = v.screenToDoc(pivot);
    v.rotateAt(pivot, Math.PI / 2);
    const after = v.screenToDoc(pivot);
    expect(after.x).toBeCloseTo(docPivot.x, 6);
    expect(after.y).toBeCloseTo(docPivot.y, 6);
    const c = v.clone();
    expect(c.equals(v)).toBe(true);
    c.panBy(1, 0);
    expect(c.equals(v)).toBe(false);
    expect(v.toState()).toEqual({ zoom: 2, panX: v.panX, panY: v.panY, rotation: Math.PI / 2 });
  });
});
