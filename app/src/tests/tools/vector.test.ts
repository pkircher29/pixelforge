import { describe, expect, it } from "vitest";
import { anchor, flattenPath, newPath, pathBounds, type Path } from "../../lib/engine";
import {
  anchorsInRect,
  appendAnchor,
  beginSubpath,
  closeLastSubpath,
  convertAnchor,
  deleteAnchor,
  dragOutHandle,
  emptyWorkPath,
  fitFreehand,
  hitHandle,
  lastSubpathOpen,
  moveHandle,
  moveSubpath,
  simplify,
} from "../../lib/tools/path-edit";
import { anchorBounds, fitPathToRect, linePolygon, parseShapeData, polygonShape, shapeDragRect, starPoints } from "../../lib/tools/shape-geom";
import { CUSTOM_SHAPES, customShapePath } from "../../lib/tools/custom-shapes";
import { hitSubpath } from "../../lib/tools/path-select";
import { fillPathInto, strokePathWithBrush } from "../../lib/tools/path-ops";
import { DEFAULT_BRUSH_SETTINGS } from "../../lib/tools/brush-engine";
import { Raster } from "../../lib/engine";

describe("pen path construction", () => {
  it("click / click builds a corner path; closing marks it closed", () => {
    let p = beginSubpath(emptyWorkPath(), { x: 0, y: 0 });
    p = appendAnchor(p, { x: 10, y: 0 });
    p = appendAnchor(p, { x: 10, y: 10 });
    expect(lastSubpathOpen(p)).toBe(true);
    p = closeLastSubpath(p);
    expect(p.subpaths[0]!.closed).toBe(true);
    expect(lastSubpathOpen(p)).toBe(false);
    expect(p.subpaths[0]!.anchors.every((a) => a.type === "corner")).toBe(true);
  });

  it("drag creates a smooth anchor with a mirrored in-handle", () => {
    let p = beginSubpath(emptyWorkPath(), { x: 10, y: 10 });
    p = dragOutHandle(p, { subpath: 0, index: 0 }, { x: 20, y: 14 });
    const a = p.subpaths[0]!.anchors[0]!;
    expect(a.type).toBe("smooth");
    expect([a.outX, a.outY]).toEqual([20, 14]);
    expect([a.inX, a.inY]).toEqual([0, 6]);
  });

  it("Alt-drag breaks the handles (in-handle untouched, corner)", () => {
    let p = beginSubpath(emptyWorkPath(), { x: 10, y: 10 });
    p = dragOutHandle(p, { subpath: 0, index: 0 }, { x: 20, y: 10 });
    p = dragOutHandle(p, { subpath: 0, index: 0 }, { x: 10, y: 30 }, true);
    const a = p.subpaths[0]!.anchors[0]!;
    expect(a.type).toBe("corner");
    expect([a.inX, a.inY]).toEqual([0, 10]);
    expect([a.outX, a.outY]).toEqual([10, 30]);
  });

  it("moving a smooth handle keeps the other collinear with its own length", () => {
    const p: Path = newPath("t", [{ closed: false, anchors: [anchor(0, 0, { inX: -5, inY: 0, outX: 10, outY: 0, type: "smooth" })] }]);
    const q = moveHandle(p, { subpath: 0, index: 0 }, "out", { x: 0, y: 10 });
    const a = q.subpaths[0]!.anchors[0]!;
    expect(a.inX).toBeCloseTo(0);
    expect(a.inY).toBeCloseTo(-5);
  });

  it("convert point toggles smooth ↔ corner", () => {
    let p = beginSubpath(emptyWorkPath(), { x: 0, y: 0 });
    p = appendAnchor(p, { x: 10, y: 0 });
    p = appendAnchor(p, { x: 20, y: 10 });
    const smooth = convertAnchor(p, { subpath: 0, index: 1 });
    expect(smooth.subpaths[0]!.anchors[1]!.type).toBe("smooth");
    const back = convertAnchor(smooth, { subpath: 0, index: 1 });
    const a = back.subpaths[0]!.anchors[1]!;
    expect(a.type).toBe("corner");
    expect(a.outX).toBe(a.x);
  });

  it("delete, marquee select, handle hit, subpath move / hit", () => {
    let p = beginSubpath(emptyWorkPath(), { x: 0, y: 0 });
    p = appendAnchor(p, { x: 50, y: 0 });
    p = appendAnchor(p, { x: 50, y: 50 });
    expect(deleteAnchor(p, { subpath: 0, index: 2 }).subpaths[0]!.anchors).toHaveLength(2);
    expect(deleteAnchor(deleteAnchor(p, { subpath: 0, index: 2 }), { subpath: 0, index: 1 }).subpaths).toHaveLength(0);
    expect(anchorsInRect(p, { x: 40, y: -5, w: 20, h: 70 })).toHaveLength(2);
    const d = dragOutHandle(p, { subpath: 0, index: 1 }, { x: 60, y: 5 });
    expect(hitHandle(d, { x: 60, y: 5 }, 2)).toEqual({ ref: { subpath: 0, index: 1 }, which: "out" });
    const moved = moveSubpath(p, 0, 5, 5);
    expect(moved.subpaths[0]!.anchors[0]!.x).toBe(5);
    expect(hitSubpath(p, { x: 25, y: 1 }, 3)).toBe(0);
    expect(hitSubpath(p, { x: 25, y: 30 }, 3)).toBeNull();
  });

  it("freeform fit simplifies a noisy line into few smooth anchors", () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 10 + (i % 2) * 0.3 }));
    const sp = fitFreehand(pts, 1.5, false);
    expect(sp.anchors.length).toBeLessThan(25);
    expect(sp.anchors.length).toBeGreaterThan(3);
    expect(sp.anchors[3]!.type).toBe("smooth");
    expect(simplify([{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }], 1)).toHaveLength(2);
  });
});

describe("shape path generation", () => {
  it("polygon has N anchors on the circumradius", () => {
    const pts = starPoints({ x: 0, y: 0 }, 10, 6);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10);
    expect(pts[0]!.y).toBeCloseTo(-10);
  });

  it("star alternates outer and indented inner radius", () => {
    const pts = starPoints({ x: 0, y: 0 }, 10, 5, { star: true, indent: 50 });
    expect(pts).toHaveLength(10);
    expect(Math.hypot(pts[1]!.x, pts[1]!.y)).toBeCloseTo(5);
    expect(polygonShape({ x: 0, y: 0 }, 10, 5, { star: true }).subpaths[0]!.closed).toBe(true);
  });

  it("line polygon has the weight and an arrowhead tip at the end", () => {
    const plain = linePolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(plain).toHaveLength(4);
    expect(Math.max(...plain.map((p) => p.y))).toBeCloseTo(2);
    const arrow = linePolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 4, { end: true, width: 500, length: 1000 });
    expect(arrow.some((p) => p.x === 100 && p.y === 0)).toBe(true);
    expect(Math.max(...arrow.map((p) => p.y))).toBeCloseTo(10);
    expect(linePolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 4, { start: true, end: true })).toHaveLength(10);
  });

  it("drag rect: shift = square, alt = from centre", () => {
    expect(shapeDragRect({ x: 10, y: 10 }, { x: 30, y: 15 }, true, false)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(shapeDragRect({ x: 10, y: 10 }, { x: 14, y: 13 }, false, true)).toEqual({ x: 6, y: 7, w: 8, h: 6 });
  });

  it("parses shape data with curves and fits it to a rect", () => {
    const p = parseShapeData("M 0 0 L 100 0 C 100 50 50 100 0 100 Z");
    expect(p.subpaths[0]!.closed).toBe(true);
    expect(p.subpaths[0]!.anchors).toHaveLength(3);
    const fitted = fitPathToRect(p, { x: 10, y: 20, w: 200, h: 100 });
    const b = anchorBounds(fitted);
    expect(b.x).toBeCloseTo(10);
    expect(b.w).toBeCloseTo(200);
  });
});

describe("custom shape library", () => {
  it("ships ≥24 shapes; each parses to closed subpaths inside the unit square", () => {
    expect(CUSTOM_SHAPES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(CUSTOM_SHAPES.map((s) => s.id)).size).toBe(CUSTOM_SHAPES.length);
    for (const s of CUSTOM_SHAPES) {
      const p = customShapePath(s.id);
      expect(p.subpaths.length, s.id).toBeGreaterThan(0);
      for (const sp of p.subpaths) {
        expect(sp.closed, s.id).toBe(true);
        expect(sp.anchors.length, s.id).toBeGreaterThanOrEqual(3);
        for (const a of sp.anchors) {
          for (const v of [a.x, a.y, a.inX, a.inY, a.outX, a.outY]) {
            expect(Number.isFinite(v), s.id).toBe(true);
            expect(v, s.id).toBeGreaterThanOrEqual(-0.01);
            expect(v, s.id).toBeLessThanOrEqual(1.01);
          }
        }
      }
      const b = pathBounds(p)!;
      expect(b.w * b.h, s.id).toBeGreaterThan(0.05);
    }
  });

  it("includes the PS staples: arrows, heart, star, talk bubble, check", () => {
    for (const id of ["arrow-right", "heart", "star-5", "bubble-round", "check"]) expect(CUSTOM_SHAPES.some((s) => s.id === id)).toBe(true);
  });
});

describe("path → pixels", () => {
  it("stroke path with the brush paints along the path only", () => {
    const r = new Raster(60, 30);
    const path = newPath("p", [{ closed: false, anchors: [anchor(5, 15), anchor(55, 15)] }]);
    strokePathWithBrush(r, { x: 0, y: 0 }, path, { ...DEFAULT_BRUSH_SETTINGS, size: 4, hardness: 100 }, { mode: "color", color: { r: 0, g: 0, b: 0, a: 255 } }, { seed: 1 });
    expect(r.getPixel(30, 15).a).toBe(255);
    expect(r.getPixel(30, 25).a).toBe(0);
    expect(flattenPath(path)[0]!.points.length).toBe(2);
  });

  it("fill path fills the interior with opacity", () => {
    const r = new Raster(20, 20);
    const path = newPath("p", [{ closed: true, anchors: [anchor(2, 2), anchor(18, 2), anchor(18, 18), anchor(2, 18)] }]);
    fillPathInto(r, { x: 0, y: 0 }, path, 20, 20, { color: { r: 255, g: 0, b: 0, a: 255 } }, { opacity: 0.5 });
    const px = r.getPixel(10, 10);
    expect(px.r).toBe(255);
    expect(px.a).toBeGreaterThan(120);
    expect(px.a).toBeLessThan(135);
    expect(r.getPixel(0, 0).a).toBe(0);
  });
});
