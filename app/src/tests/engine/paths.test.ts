import { describe, expect, it } from "vitest";
import {
  History,
  Raster,
  Rect,
  Selection,
  SetPathsCommand,
  anchor,
  bezierPoint,
  createDocument,
  ellipsePath,
  fillPathToRaster,
  flattenPath,
  gradientFill,
  nearestAnchor,
  nearestSegment,
  newPath,
  pathBounds,
  pathCoverage,
  pathToSelection,
  polygonPath,
  polygonsCoverage,
  rectPath,
  regularPolygonPath,
  removeAnchor,
  rgba,
  roundedRectPath,
  selectionToPath,
  setPathCommand,
  simplifyPolyline,
  smoothAnchors,
  splitSegmentAt,
  strokeOutline,
  strokePathToRaster,
  traceMaskOutlines,
  translatePath,
  type Path,
} from "../../lib/engine";

function sumCoverage(cov: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < cov.length; i++) s += cov[i]!;
  return s / 255;
}

describe("path construction and flattening", () => {
  it("rect / ellipse / polygon / rounded rect produce closed subpaths with sensible bounds", () => {
    const r = rectPath(Rect.make(2, 3, 10, 5));
    expect(r.subpaths[0]!.closed).toBe(true);
    expect(r.subpaths[0]!.anchors).toHaveLength(4);
    expect(pathBounds(r)).toEqual(Rect.make(2, 3, 10, 5));
    const e = ellipsePath(Rect.make(0, 0, 20, 10));
    const eb = pathBounds(e)!;
    expect(eb.w).toBeCloseTo(20, 0);
    expect(eb.h).toBeCloseTo(10, 0);
    const p = regularPolygonPath(10, 10, 5, 6);
    expect(p.subpaths[0]!.anchors).toHaveLength(6);
    const rr = roundedRectPath(Rect.make(0, 0, 10, 10), 3);
    expect(rr.subpaths[0]!.anchors).toHaveLength(8);
    expect(roundedRectPath(Rect.make(0, 0, 10, 10), 0).subpaths[0]!.anchors).toHaveLength(4);
    expect(pathBounds(newPath())).toBeNull();
  });

  it("flattens straight segments to their endpoints and curves to polylines on the bezier", () => {
    const straight = flattenPath(polygonPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]));
    expect(straight[0]!.points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]);
    const e = ellipsePath(Rect.make(0, 0, 100, 100));
    const pts = flattenPath(e)[0]!.points;
    expect(pts.length).toBeGreaterThan(16);
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - 50, p.y - 50) - 50)).toBeLessThan(0.6);
    const a = anchor(0, 0, { outX: 0, outY: 10 });
    const b = anchor(10, 10, { inX: 10, inY: 0 });
    const mid = bezierPoint(a, b, 0.5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(5);
    const t = translatePath(rectPath(Rect.make(0, 0, 2, 2)), 5, 7);
    expect(pathBounds(t)).toEqual(Rect.make(5, 7, 2, 2));
  });
});

describe("scanline coverage", () => {
  it("fills an axis-aligned rect exactly, with fractional edges anti-aliased", () => {
    const cov = pathCoverage(rectPath(Rect.make(2, 2, 4, 3)), 10, 10);
    expect(sumCoverage(cov)).toBeCloseTo(12, 5);
    expect(cov[2 * 10 + 2]).toBe(255);
    expect(cov[1 * 10 + 2]).toBe(0);
    const half = pathCoverage(rectPath(Rect.make(2.5, 2, 4, 3)), 10, 10);
    expect(half[2 * 10 + 2]).toBe(128);
    expect(half[2 * 10 + 6]).toBe(128);
    expect(sumCoverage(half)).toBeCloseTo(12, 1);
    // Non-AA: a pixel is in when its centre is inside (2.6 excludes pixel 2, includes 3..6).
    const hard = pathCoverage(rectPath(Rect.make(2.6, 2, 4, 3)), 10, 10, { aa: false });
    expect(hard[2 * 10 + 2]).toBe(0);
    expect(hard[2 * 10 + 3]).toBe(255);
    expect(hard[2 * 10 + 6]).toBe(255);
    expect(hard[2 * 10 + 7]).toBe(0);
  });

  it("nonzero vs even-odd on overlapping squares", () => {
    const outer = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }];
    const innerSame = [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }];
    const innerReversed = [...innerSame].reverse();
    const nz = polygonsCoverage([outer, innerSame], 8, 8, { rule: "nonzero" });
    expect(nz[4 * 8 + 4]).toBe(255);
    const eo = polygonsCoverage([outer, innerSame], 8, 8, { rule: "evenodd" });
    expect(eo[4 * 8 + 4]).toBe(0);
    expect(eo[0]).toBe(255);
    const nzHole = polygonsCoverage([outer, innerReversed], 8, 8, { rule: "nonzero" });
    expect(nzHole[4 * 8 + 4]).toBe(0);
  });

  it("anti-aliases a diagonal edge and the ellipse area is close to pi r^2", () => {
    const tri = polygonPath([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }]);
    const cov = pathCoverage(tri, 8, 8);
    expect(sumCoverage(cov)).toBeCloseTo(32, 1);
    const diag = cov[3 * 8 + 4]!; // on the hypotenuse
    expect(diag).toBeGreaterThan(0);
    expect(diag).toBeLessThan(255);
    const circle = pathCoverage(ellipsePath(Rect.make(0, 0, 40, 40)), 40, 40);
    expect(Math.abs(sumCoverage(circle) - Math.PI * 400)).toBeLessThan(6);
  });
});

describe("path ↔ selection", () => {
  it("pathToSelection fills with AA and optional feather", () => {
    const s = pathToSelection(rectPath(Rect.make(2, 2, 4, 4)), 10, 10);
    expect(s.get(3, 3)).toBe(255);
    expect(s.get(1, 1)).toBe(0);
    expect(s.bbox).toEqual(Rect.make(2, 2, 4, 4));
    const f = pathToSelection(rectPath(Rect.make(2, 2, 4, 4)), 10, 10, { feather: 1 });
    expect(f.get(1, 3)).toBeGreaterThan(0);
    expect(f.get(3, 3)).toBeLessThan(255);
  });

  it("traceMaskOutlines returns closed rings along pixel edges, including holes", () => {
    const m = new Uint8Array(10 * 10);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) m[y * 10 + x] = 255;
    const rings = traceMaskOutlines(m, 10, 10);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring).toHaveLength(4);
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    expect(Math.min(...xs)).toBe(2);
    expect(Math.max(...xs)).toBe(8);
    expect(Math.min(...ys)).toBe(2);
    expect(Math.max(...ys)).toBe(8);
    // Punch a hole.
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) m[y * 10 + x] = 0;
    const withHole = traceMaskOutlines(m, 10, 10);
    expect(withHole).toHaveLength(2);
  });

  it("selectionToPath round-trips a rectangle and simplifies a disc with tolerance", () => {
    const sel = Selection.fromRect(20, 20, Rect.make(3, 4, 6, 5));
    const path = selectionToPath(sel, 1);
    expect(path.subpaths).toHaveLength(1);
    expect(path.subpaths[0]!.anchors).toHaveLength(4);
    expect(pathBounds(path)).toEqual(Rect.make(3, 4, 6, 5));
    const back = pathToSelection(path, 20, 20);
    expect(back.bbox).toEqual(Rect.make(3, 4, 6, 5));
    for (let i = 0; i < back.mask.length; i++) expect(back.mask[i]).toBe(sel.mask[i]);
    const disc = Selection.fromEllipse(40, 40, Rect.make(5, 5, 30, 30), false);
    const coarse = selectionToPath(disc, 2);
    const fine = selectionToPath(disc, 0);
    expect(coarse.subpaths[0]!.anchors.length).toBeLessThan(fine.subpaths[0]!.anchors.length);
    const smooth = selectionToPath(disc, 2, { smooth: true });
    expect(smooth.subpaths[0]!.anchors[0]!.type).toBe("smooth");
    // Tracing follows pixel edges, so a tolerance-2 outline is only roughly circular (~10 %).
    const area = sumCoverage(pathCoverage(smooth, 40, 40));
    expect(Math.abs(area - Math.PI * 225)).toBeLessThan(80);
    expect(pathBounds(smooth)!.w).toBeGreaterThan(26);
    expect(pathBounds(smooth)!.w).toBeLessThan(34);
  });

  it("Douglas-Peucker keeps corners and drops collinear noise", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0.2 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(simplifyPolyline(pts, 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(simplifyPolyline(pts, 0.1)).toHaveLength(4);
  });
});

describe("stroking", () => {
  it("strokeOutline makes consistently oriented polygons; a stroked line covers width x length", () => {
    const polys = strokeOutline([{ x: 2, y: 5 }, { x: 12, y: 5 }], false, 2);
    expect(polys).toHaveLength(1);
    const cov = polygonsCoverage(polys, 16, 10);
    expect(sumCoverage(cov)).toBeCloseTo(20, 3);
    expect(cov[4 * 16 + 5]).toBe(255);
    expect(cov[5 * 16 + 5]).toBe(255);
    expect(cov[3 * 16 + 5]).toBe(0);
    const sq = strokeOutline([{ x: 2, y: 5 }, { x: 12, y: 5 }], false, 2, { cap: "square" });
    expect(sumCoverage(polygonsCoverage(sq, 16, 10))).toBeCloseTo(24, 3);
    const round = strokeOutline([{ x: 2, y: 5 }, { x: 12, y: 5 }], false, 2, { cap: "round" });
    const ra = sumCoverage(polygonsCoverage(round, 16, 10));
    expect(ra).toBeGreaterThan(20);
    expect(ra).toBeLessThan(24);
  });

  it("joins: miter fills the corner, bevel cuts it, round rounds it", () => {
    const pts = [{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 12 }];
    const miter = sumCoverage(polygonsCoverage(strokeOutline(pts, false, 4, { join: "miter" }), 20, 20));
    const bevel = sumCoverage(polygonsCoverage(strokeOutline(pts, false, 4, { join: "bevel" }), 20, 20));
    const round = sumCoverage(polygonsCoverage(strokeOutline(pts, false, 4, { join: "round" }), 20, 20));
    expect(miter).toBeGreaterThan(round);
    expect(round).toBeGreaterThan(bevel);
    // The miter tip at the outer corner (13.9, 0.1) is covered.
    const mc = polygonsCoverage(strokeOutline(pts, false, 4, { join: "miter" }), 20, 20);
    expect(mc[0 * 20 + 13]).toBe(255);
    const bc = polygonsCoverage(strokeOutline(pts, false, 4, { join: "bevel" }), 20, 20);
    expect(bc[0 * 20 + 13]).toBe(0);
  });

  it("closed paths stroke all the way round; dashes split the stroke", () => {
    const sq = rectPath(Rect.make(4, 4, 8, 8));
    const solid = strokePathToRaster(sq, 2, rgba(255, 0, 0), {}, 16, 16);
    expect(solid.getPixel(4, 8)).toEqual(rgba(255, 0, 0));
    expect(solid.getPixel(8, 4)).toEqual(rgba(255, 0, 0));
    expect(solid.getPixel(8, 8).a).toBe(0);
    const dashed = strokePathToRaster(sq, 2, rgba(255, 0, 0), { dash: [2, 2] }, 16, 16);
    let on = 0;
    let off = 0;
    for (let x = 4; x < 12; x++) (dashed.getPixel(x, 4).a > 0 ? on++ : off++);
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
    const total = (r: Raster): number => {
      let s = 0;
      for (let i = 3; i < r.data.length; i += 4) s += r.data[i]!;
      return s;
    };
    expect(total(dashed)).toBeLessThan(total(solid));
  });

  it("fillPathToRaster supports gradients", () => {
    const g = gradientFill([{ pos: 0, color: rgba(0, 0, 0) }, { pos: 1, color: rgba(255, 255, 255) }], { angle: 0 });
    const r = fillPathToRaster(rectPath(Rect.make(0, 0, 16, 4)), g, 16, 4);
    expect(r.getPixel(0, 1).r).toBeLessThan(r.getPixel(15, 1).r);
    expect(r.getPixel(8, 1).a).toBe(255);
  });
});

describe("hit testing and editing", () => {
  const path: Path = newPath("p", [{ closed: false, anchors: [anchor(0, 0, { outX: 0, outY: 10 }), anchor(10, 10, { inX: 10, inY: 0 }), anchor(20, 10)] }]);

  it("nearestAnchor finds anchors and handles within the radius", () => {
    expect(nearestAnchor(path, { x: 10.5, y: 9.8 }, 3)).toMatchObject({ subpath: 0, index: 1, part: "anchor" });
    expect(nearestAnchor(path, { x: 50, y: 50 }, 3)).toBeNull();
    expect(nearestAnchor(path, { x: 0, y: 9.5 }, 2, true)).toMatchObject({ index: 0, part: "out" });
    expect(nearestAnchor(path, { x: 0, y: 9.5 }, 2, false)).toBeNull();
  });

  it("nearestSegment returns the closest point and parameter on a curve or line", () => {
    const hit = nearestSegment(path, { x: 5.5, y: 4.5 }, 3)!;
    expect(hit).not.toBeNull();
    expect(hit.subpath).toBe(0);
    expect(hit.index).toBe(0);
    expect(hit.t).toBeCloseTo(0.5, 1);
    expect(hit.point.x).toBeCloseTo(5, 0);
    const line = nearestSegment(path, { x: 15, y: 11 }, 3)!;
    expect(line.index).toBe(1);
    expect(line.t).toBeCloseTo(0.5, 1);
    expect(line.dist).toBeCloseTo(1, 5);
    expect(nearestSegment(path, { x: 100, y: 100 }, 3)).toBeNull();
  });

  it("splitSegmentAt inserts an anchor without changing the curve; removeAnchor deletes", () => {
    const split = splitSegmentAt(path, 0, 0, 0.5);
    expect(split).not.toBe(path);
    expect(split.subpaths[0]!.anchors).toHaveLength(4);
    const mid = split.subpaths[0]!.anchors[1]!;
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(5);
    expect(mid.type).toBe("smooth");
    // Same flattened geometry (sample a few points).
    const before = flattenPath(path, 0.05)[0]!.points;
    const after = flattenPath(split, 0.05)[0]!.points;
    for (const p of [before[Math.floor(before.length / 3)]!, before[Math.floor(before.length / 2)]!]) {
      const d = Math.min(...after.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(d).toBeLessThan(0.2);
    }
    const straightSplit = splitSegmentAt(path, 0, 1, 0.25);
    expect(straightSplit.subpaths[0]!.anchors[2]).toMatchObject({ x: 12.5, y: 10, type: "corner" });
    const removed = removeAnchor(split, 0, 1);
    expect(removed.subpaths[0]!.anchors).toHaveLength(3);
    expect(path.subpaths[0]!.anchors).toHaveLength(3); // input untouched
    const smoothed = newPath("s", [{ closed: true, anchors: [anchor(0, 0), anchor(10, 0), anchor(10, 10), anchor(0, 10)] }]);
    smoothAnchors(smoothed.subpaths[0]!.anchors, true);
    expect(smoothed.subpaths[0]!.anchors[0]!.outX).not.toBe(0);
  });

  it("SetPathsCommand / setPathCommand store deep copies and undo", () => {
    const doc = createDocument({ width: 8, height: 8 });
    const h = new History(doc);
    const p1 = rectPath(Rect.make(0, 0, 4, 4), "A");
    h.push(setPathCommand(doc, p1));
    expect(doc.paths).toHaveLength(1);
    expect(doc.paths[0]).not.toBe(p1);
    expect(doc.workPathId).toBe(p1.id);
    const p1b = translatePath(p1, 1, 1);
    h.push(setPathCommand(doc, p1b, "Move Path"));
    expect(doc.paths).toHaveLength(1);
    expect(pathBounds(doc.paths[0]!)).toEqual(Rect.make(1, 1, 4, 4));
    h.undo();
    expect(pathBounds(doc.paths[0]!)).toEqual(Rect.make(0, 0, 4, 4));
    h.push(new SetPathsCommand([], null, "Delete Path"));
    expect(doc.paths).toHaveLength(0);
    h.undo();
    expect(doc.paths).toHaveLength(1);
  });
});
