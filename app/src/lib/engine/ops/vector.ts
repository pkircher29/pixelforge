/**
 * Vector paths: bezier flattening, anti-aliased scanline fill (nonzero / even-odd),
 * stroking by polyline offset (caps, joins, dashes), path ↔ selection conversion
 * (marching-squares outline + Douglas-Peucker) and hit-testing helpers for the Pen /
 * Direct Selection tools. Pure CPU; shape layers rasterize with these.
 */

import { Rect, type Point } from "../rect";
import { Raster } from "../raster";
import { Selection } from "../selection";
import type { Anchor, FillRule, GradientFill, LineCap, LineJoin, Path, RGBA, SolidFill, Subpath } from "../types";
import { gradientLut, gradientParam } from "./fill";

let pathCounter = 0;

/** Unique path id. */
export function newPathId(prefix = "path"): string {
  pathCounter++;
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID().slice(0, 8)}_${pathCounter}`;
  return `${prefix}_${Date.now().toString(36)}_${pathCounter}`;
}

/** A corner anchor with collapsed handles (straight segments on both sides). */
export function anchor(x: number, y: number, over: Partial<Anchor> = {}): Anchor {
  return { x, y, inX: x, inY: y, outX: x, outY: y, type: "corner", ...over };
}

export function newPath(name = "Work Path", subpaths: Subpath[] = [], id?: string): Path {
  return { id: id ?? newPathId(), name, subpaths };
}

/** Deep copy. */
export function clonePath(p: Path): Path {
  return { id: p.id, name: p.name, subpaths: p.subpaths.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) })) };
}

/** Translate every anchor and handle. */
export function translatePath(p: Path, dx: number, dy: number): Path {
  const c = clonePath(p);
  for (const s of c.subpaths) {
    for (const a of s.anchors) {
      a.x += dx;
      a.y += dy;
      a.inX += dx;
      a.inY += dy;
      a.outX += dx;
      a.outY += dy;
    }
  }
  return c;
}

/** Axis-aligned rectangle path (closed, 4 corner anchors). */
export function rectPath(r: Rect, name = "Rectangle"): Path {
  return newPath(name, [
    { closed: true, anchors: [anchor(r.x, r.y), anchor(r.x + r.w, r.y), anchor(r.x + r.w, r.y + r.h), anchor(r.x, r.y + r.h)] },
  ]);
}

/** Rounded rectangle (bezier corners), radius clamped to half the shorter side. */
export function roundedRectPath(r: Rect, radius: number, name = "Rounded Rectangle"): Path {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  if (rad === 0) return rectPath(r, name);
  const k = 0.5522847498 * rad;
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const a: Anchor[] = [
    { x: x0 + rad, y: y0, inX: x0 + rad - k, inY: y0, outX: x0 + rad, outY: y0, type: "smooth" },
    { x: x1 - rad, y: y0, inX: x1 - rad, inY: y0, outX: x1 - rad + k, outY: y0, type: "smooth" },
    { x: x1, y: y0 + rad, inX: x1, inY: y0 + rad - k, outX: x1, outY: y0 + rad, type: "smooth" },
    { x: x1, y: y1 - rad, inX: x1, inY: y1 - rad, outX: x1, outY: y1 - rad + k, type: "smooth" },
    { x: x1 - rad, y: y1, inX: x1 - rad + k, inY: y1, outX: x1 - rad, outY: y1, type: "smooth" },
    { x: x0 + rad, y: y1, inX: x0 + rad, inY: y1, outX: x0 + rad - k, outY: y1, type: "smooth" },
    { x: x0, y: y1 - rad, inX: x0, inY: y1 - rad + k, outX: x0, outY: y1 - rad, type: "smooth" },
    { x: x0, y: y0 + rad, inX: x0, inY: y0 + rad, outX: x0, outY: y0 + rad - k, type: "smooth" },
  ];
  return newPath(name, [{ closed: true, anchors: a }]);
}

/** Ellipse inscribed in `r` (4 smooth anchors with the standard 0.5523 kappa). */
export function ellipsePath(r: Rect, name = "Ellipse"): Path {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const kx = 0.5522847498 * rx;
  const ky = 0.5522847498 * ry;
  const a: Anchor[] = [
    { x: cx, y: cy - ry, inX: cx - kx, inY: cy - ry, outX: cx + kx, outY: cy - ry, type: "smooth" },
    { x: cx + rx, y: cy, inX: cx + rx, inY: cy - ky, outX: cx + rx, outY: cy + ky, type: "smooth" },
    { x: cx, y: cy + ry, inX: cx + kx, inY: cy + ry, outX: cx - kx, outY: cy + ry, type: "smooth" },
    { x: cx - rx, y: cy, inX: cx - rx, inY: cy + ky, outX: cx - rx, outY: cy - ky, type: "smooth" },
  ];
  return newPath(name, [{ closed: true, anchors: a }]);
}

/** Polygon / polyline path from points. */
export function polygonPath(points: readonly Point[], closed = true, name = "Polygon"): Path {
  return newPath(name, [{ closed, anchors: points.map((p) => anchor(p.x, p.y)) }]);
}

/** Regular polygon with `sides` vertices inscribed in a circle. */
export function regularPolygonPath(cx: number, cy: number, radius: number, sides: number, name = "Polygon"): Path {
  const pts: Point[] = [];
  const n = Math.max(3, Math.round(sides));
  for (let i = 0; i < n; i++) {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
  }
  return polygonPath(pts, true, name);
}

// ---------------------------------------------------------------------------
// Bezier flattening
// ---------------------------------------------------------------------------

/** Point on the cubic from anchor `a` to anchor `b` at `t`. */
export function bezierPoint(a: Anchor, b: Anchor, t: number, out: Point = { x: 0, y: 0 }): Point {
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  out.x = w0 * a.x + w1 * a.outX + w2 * b.inX + w3 * b.x;
  out.y = w0 * a.y + w1 * a.outY + w2 * b.inY + w3 * b.y;
  return out;
}

function isStraight(a: Anchor, b: Anchor): boolean {
  return a.outX === a.x && a.outY === a.y && b.inX === b.x && b.inY === b.y;
}

/** Flatten one segment, appending points **after** `a` (excluding `a`, including `b`). */
function flattenSegment(a: Anchor, b: Anchor, out: Point[], tolerance: number): void {
  if (isStraight(a, b)) {
    out.push({ x: b.x, y: b.y });
    return;
  }
  const len = Math.hypot(a.outX - a.x, a.outY - a.y) + Math.hypot(b.inX - a.outX, b.inY - a.outY) + Math.hypot(b.x - b.inX, b.y - b.inY);
  const segs = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(len / Math.max(0.05, tolerance)) * 1.2)));
  for (let i = 1; i <= segs; i++) out.push(bezierPoint(a, b, i / segs));
}

/** Flatten a subpath into a polyline (closed subpaths do not repeat the first point). */
export function flattenSubpath(sp: Subpath, tolerance = 0.25): Point[] {
  const n = sp.anchors.length;
  if (n === 0) return [];
  const out: Point[] = [{ x: sp.anchors[0]!.x, y: sp.anchors[0]!.y }];
  for (let i = 0; i + 1 < n; i++) flattenSegment(sp.anchors[i]!, sp.anchors[i + 1]!, out, tolerance);
  if (sp.closed && n > 1) {
    flattenSegment(sp.anchors[n - 1]!, sp.anchors[0]!, out, tolerance);
    out.pop(); // the closing point equals the first
  }
  return out;
}

/** Flatten every subpath. */
export function flattenPath(path: Path, tolerance = 0.25): { points: Point[]; closed: boolean }[] {
  return path.subpaths.map((sp) => ({ points: flattenSubpath(sp, tolerance), closed: sp.closed }));
}

/** Bounding rect of the flattened path (null when empty). */
export function pathBounds(path: Path): Rect | null {
  const pts: Point[] = [];
  for (const sp of flattenPath(path)) pts.push(...sp.points);
  if (pts.length === 0) return null;
  return Rect.boundingPoints(pts);
}

// ---------------------------------------------------------------------------
// Scanline coverage
// ---------------------------------------------------------------------------

export interface CoverageOptions {
  rule?: FillRule;
  /** 4 sub-scanlines + fractional spans (default true). */
  aa?: boolean;
}

/**
 * Rasterize closed polygons into a `w x h` coverage buffer (0..255) with the given fill
 * rule. Every polygon is implicitly closed. Anti-aliasing uses 4 sub-scanlines per row
 * and exact fractional horizontal span ends.
 */
export function polygonsCoverage(polys: readonly (readonly Point[])[], w: number, h: number, opts: CoverageOptions = {}): Uint8Array {
  const cov = new Uint8Array(w * h);
  const rule = opts.rule ?? "nonzero";
  const aa = opts.aa ?? true;
  const all: Point[] = [];
  for (const p of polys) all.push(...p);
  if (all.length < 3) return cov;
  const bb = Rect.intersect(Rect.roundOut(Rect.boundingPoints(all)), Rect.ofSize(w, h));
  if (Rect.isEmpty(bb)) return cov;
  const SS = aa ? 4 : 1;
  const acc = new Float32Array(w + 1);
  const xs: number[] = [];
  const dirs: number[] = [];
  const order: number[] = [];
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    acc.fill(0, bb.x, bb.x + bb.w + 1);
    for (let k = 0; k < SS; k++) {
      const sy = y + (k + 0.5) / SS;
      xs.length = 0;
      dirs.length = 0;
      for (const poly of polys) {
        const n = poly.length;
        if (n < 2) continue;
        for (let i = 0; i < n; i++) {
          const a = poly[i]!;
          const b = poly[(i + 1) % n]!;
          if (a.y === b.y) continue;
          const dir = b.y > a.y ? 1 : -1;
          const yTop = dir > 0 ? a.y : b.y;
          const yBot = dir > 0 ? b.y : a.y;
          if (sy < yTop || sy >= yBot) continue;
          xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
          dirs.push(dir);
        }
      }
      const m = xs.length;
      if (m < 2) continue;
      order.length = m;
      for (let i = 0; i < m; i++) order[i] = i;
      order.sort((p, q) => xs[p]! - xs[q]!);
      let wind = 0;
      for (let i = 0; i + 1 < m; i++) {
        const idx = order[i]!;
        wind += rule === "nonzero" ? dirs[idx]! : 1;
        const inside = rule === "nonzero" ? wind !== 0 : (wind & 1) === 1;
        if (!inside) continue;
        const xa = Math.max(bb.x, xs[idx]!);
        const xb = Math.min(bb.x + bb.w, xs[order[i + 1]!]!);
        if (xb <= xa) continue;
        if (!aa) {
          const px0 = Math.ceil(xa - 0.5);
          const px1 = Math.ceil(xb - 0.5);
          for (let x = px0; x < px1; x++) acc[x] = 1;
          continue;
        }
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          acc[ia] = acc[ia]! + (xb - xa) / SS;
        } else {
          acc[ia] = acc[ia]! + (ia + 1 - xa) / SS;
          for (let x = ia + 1; x < ib; x++) acc[x] = acc[x]! + 1 / SS;
          if (ib < bb.x + bb.w) acc[ib] = acc[ib]! + (xb - ib) / SS;
        }
      }
    }
    const row = y * w;
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const c = acc[x]!;
      if (c > 0) cov[row + x] = Math.min(255, Math.round(c * 255));
    }
  }
  return cov;
}

/** Coverage of a path's fill (open subpaths are closed implicitly, as in PS). */
export function pathCoverage(path: Path, w: number, h: number, opts: CoverageOptions & { tolerance?: number } = {}): Uint8Array {
  const polys = flattenPath(path, opts.tolerance ?? 0.25).map((s) => s.points);
  return polygonsCoverage(polys, w, h, opts);
}

/** Path → selection (Paths panel "Load path as selection"). */
export function pathToSelection(path: Path, w: number, h: number, opts: { feather?: number; aa?: boolean; rule?: FillRule } = {}): Selection {
  const cov = pathCoverage(path, w, h, { aa: opts.aa ?? true, rule: opts.rule ?? "nonzero" });
  const s = Selection.fromMask(w, h, cov);
  return opts.feather && opts.feather > 0 ? s.feather(opts.feather) : s;
}

/** Paint a coverage buffer with a solid color or a gradient (laid out over `bounds`) into a raster. */
export function coverageToRaster(cov: Uint8Array, w: number, h: number, fill: SolidFill | GradientFill | RGBA, bounds?: Rect): Raster {
  const out = new Raster(w, h);
  const d = out.data;
  const spec: SolidFill | GradientFill = "type" in fill ? fill : { type: "solid", color: fill };
  if (spec.type === "solid") {
    const c = spec.color;
    for (let i = 0, p = 0; i < cov.length; i++, p += 4) {
      const v = cov[i]!;
      if (v === 0) continue;
      d[p] = c.r;
      d[p + 1] = c.g;
      d[p + 2] = c.b;
      d[p + 3] = (v * c.a) / 255;
    }
    return out;
  }
  const b = bounds ?? coverageBounds(cov, w, h) ?? Rect.ofSize(w, h);
  const lut = gradientLut(spec.gradient, spec.reverse);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = cov[i]!;
      if (v === 0) continue;
      const t = gradientParam(spec.style, x + 0.5, y + 0.5, b, spec.angle, spec.scale, spec.offset);
      const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
      const p = i * 4;
      d[p] = lut[k]!;
      d[p + 1] = lut[k + 1]!;
      d[p + 2] = lut[k + 2]!;
      d[p + 3] = (v * lut[k + 3]!) / 255;
    }
  }
  return out;
}

/** Bounding rect of non-zero coverage, or null. */
export function coverageBounds(cov: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (cov[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Fill a path into a new `w x h` raster. */
export function fillPathToRaster(path: Path, fill: SolidFill | GradientFill | RGBA, w: number, h: number, opts: CoverageOptions = {}): Raster {
  const cov = pathCoverage(path, w, h, opts);
  return coverageToRaster(cov, w, h, fill);
}

// ---------------------------------------------------------------------------
// Stroking
// ---------------------------------------------------------------------------

export interface StrokeOptions {
  cap?: LineCap;
  join?: LineJoin;
  /** `[on, off, ...]` in px; null/empty = solid. */
  dash?: number[] | null;
  /** Miter limit (ratio), PS default 10. */
  miterLimit?: number;
  aa?: boolean;
}

function signedArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Ensure a consistent (positive signed area) orientation so nonzero union works. */
function orient(poly: Point[]): Point[] {
  return signedArea(poly) < 0 ? poly.reverse() : poly;
}

function circlePoly(cx: number, cy: number, r: number): Point[] {
  const n = Math.max(8, Math.min(64, Math.ceil(r * 2)));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return orient(pts);
}

/** Split a polyline into dashes (each an open polyline). */
function applyDash(points: readonly Point[], closed: boolean, dash: readonly number[]): Point[][] {
  const pattern = dash.filter((d) => d >= 0);
  const total = pattern.reduce((a, b) => a + b, 0);
  if (pattern.length === 0 || total <= 0) return [points.slice()];
  const pts = closed && points.length > 1 ? [...points, points[0]!] : points.slice();
  const out: Point[][] = [];
  let di = 0;
  let remain = pattern[0]!;
  let on = true;
  let cur: Point[] = on ? [pts[0]!] : [];
  for (let i = 0; i + 1 < pts.length; i++) {
    let a = pts[i]!;
    const b = pts[i + 1]!;
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    while (segLen > 0) {
      if (remain >= segLen) {
        remain -= segLen;
        if (on) cur.push(b);
        segLen = 0;
        break;
      }
      const t = remain / segLen;
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) {
        cur.push(m);
        if (cur.length > 1) out.push(cur);
        cur = [];
      } else {
        cur = [m];
      }
      on = !on;
      segLen -= remain;
      a = m;
      di = (di + 1) % pattern.length;
      remain = pattern[di]!;
      if (remain === 0) {
        // Zero-length entries: skip immediately.
        on = !on;
        di = (di + 1) % pattern.length;
        remain = pattern[di]!;
        if (on) cur = [m];
      }
    }
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

/**
 * Outline polygons (consistently oriented, to be filled with the nonzero rule) of a
 * stroked polyline. Caps apply to open polylines only.
 */
export function strokeOutline(points: readonly Point[], closed: boolean, width: number, opts: StrokeOptions = {}): Point[][] {
  const hw = width / 2;
  if (hw <= 0 || points.length === 0) return [];
  const cap = opts.cap ?? "butt";
  const join = opts.join ?? "miter";
  const miterLimit = opts.miterLimit ?? 10;
  // Drop duplicate consecutive points.
  const pts: Point[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  if (closed && pts.length > 1 && pts[0]!.x === pts[pts.length - 1]!.x && pts[0]!.y === pts[pts.length - 1]!.y) pts.pop();
  const out: Point[][] = [];
  if (pts.length === 1) {
    const p = pts[0]!;
    if (cap === "round") out.push(circlePoly(p.x, p.y, hw));
    else if (cap === "square") out.push(orient([{ x: p.x - hw, y: p.y - hw }, { x: p.x + hw, y: p.y - hw }, { x: p.x + hw, y: p.y + hw }, { x: p.x - hw, y: p.y + hw }]));
    return out;
  }
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  const dirs: Point[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    dirs.push({ x: (b.x - a.x) / len, y: (b.y - a.y) / len });
  }
  // Segment quads.
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const d = dirs[i]!;
    const nx = -d.y * hw;
    const ny = d.x * hw;
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    if (!closed && cap === "square") {
      if (i === 0) {
        ax -= d.x * hw;
        ay -= d.y * hw;
      }
      if (i === segCount - 1) {
        bx += d.x * hw;
        by += d.y * hw;
      }
    }
    out.push(orient([{ x: ax + nx, y: ay + ny }, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }, { x: ax - nx, y: ay - ny }]));
  }
  // Joins.
  const joinStart = closed ? 0 : 1;
  const joinEnd = closed ? n : n - 1;
  for (let i = joinStart; i < joinEnd; i++) {
    const p = pts[i]!;
    const d1 = dirs[(i - 1 + segCount) % segCount]!;
    const d2 = dirs[i % segCount]!;
    if (join === "round") {
      out.push(circlePoly(p.x, p.y, hw));
      continue;
    }
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-9 && d1.x * d2.x + d1.y * d2.y > 0) continue; // collinear
    const sign = cross > 0 ? -1 : 1;
    const n1 = { x: -d1.y * sign, y: d1.x * sign };
    const n2 = { x: -d2.y * sign, y: d2.x * sign };
    const o1 = { x: p.x + n1.x * hw, y: p.y + n1.y * hw };
    const o2 = { x: p.x + n2.x * hw, y: p.y + n2.y * hw };
    const dot = n1.x * n2.x + n1.y * n2.y;
    const miterRatio = 1 / Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
    if (join === "miter" && miterRatio <= miterLimit) {
      const k = hw / (1 + dot);
      const tip = { x: p.x + (n1.x + n2.x) * k, y: p.y + (n1.y + n2.y) * k };
      out.push(orient([{ x: p.x, y: p.y }, o1, tip, o2]));
    } else {
      out.push(orient([{ x: p.x, y: p.y }, o1, o2]));
    }
  }
  // Caps.
  if (!closed && cap === "round") {
    out.push(circlePoly(pts[0]!.x, pts[0]!.y, hw));
    out.push(circlePoly(pts[n - 1]!.x, pts[n - 1]!.y, hw));
  }
  return out;
}

/** Coverage (0..255) of a stroked path. */
export function strokePathCoverage(path: Path, width: number, w: number, h: number, opts: StrokeOptions = {}): Uint8Array {
  const polys: Point[][] = [];
  for (const sp of flattenPath(path)) {
    if (sp.points.length === 0) continue;
    const pieces = opts.dash && opts.dash.length > 0 ? applyDash(sp.points, sp.closed, opts.dash) : [sp.points];
    const dashed = !!opts.dash && opts.dash.length > 0;
    for (const piece of pieces) polys.push(...strokeOutline(piece, sp.closed && !dashed, width, opts));
  }
  return polygonsCoverage(polys, w, h, { rule: "nonzero", aa: opts.aa ?? true });
}

/** Stroke a path into a new `w x h` raster with a color or gradient. */
export function strokePathToRaster(path: Path, width: number, color: RGBA | SolidFill | GradientFill, opts: StrokeOptions, w: number, h: number): Raster {
  const cov = strokePathCoverage(path, width, w, h, opts);
  return coverageToRaster(cov, w, h, color);
}

// ---------------------------------------------------------------------------
// Selection → path
// ---------------------------------------------------------------------------

/** Perpendicular distance from `p` to segment `a-b`. */
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Douglas-Peucker simplification of an open polyline. */
export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(points[i]!, points[s]!, points[e]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

/** Simplify a closed ring (splits at the farthest point from the first so DP sees two open halves). */
export function simplifyRing(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 3 || tolerance <= 0) return points.slice();
  let far = 0;
  let maxD = -1;
  const p0 = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]!.x - p0.x, points[i]!.y - p0.y);
    if (d > maxD) {
      maxD = d;
      far = i;
    }
  }
  const a = simplifyPolyline(points.slice(0, far + 1), tolerance);
  const b = simplifyPolyline([...points.slice(far), p0], tolerance);
  const out = [...a, ...b.slice(1, -1)];
  return out.length >= 3 ? out : points.slice();
}

/**
 * Trace the outlines of a binary mask (threshold 128) as closed rings along pixel
 * edges. Outer rings are counter-clockwise (in y-down coordinates), holes clockwise.
 */
export function traceMaskOutlines(mask: Uint8Array, w: number, h: number, threshold = 128): Point[][] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]! >= threshold;
  // Directed edges keyed by start vertex; vertices are pixel corners (x, y) in 0..w, 0..h.
  const key = (x: number, y: number): number => y * (w + 1) + x;
  const edges = new Map<number, number[]>(); // start -> list of end keys
  const addEdge = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = key(x0, y0);
    const list = edges.get(k);
    if (list) list.push(key(x1, y1));
    else edges.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      // Orientation: region on the left of each edge when walking (y-down → clockwise on screen = CCW math).
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y); // top edge, left → right
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // right edge, top → bottom
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bottom edge, right → left
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y); // left edge, bottom → top
    }
  }
  const rings: Point[][] = [];
  const toPoint = (k: number): Point => ({ x: k % (w + 1), y: Math.floor(k / (w + 1)) });
  for (const [startKey] of edges) {
    const first = edges.get(startKey);
    if (!first || first.length === 0) continue;
    const ring: Point[] = [];
    let cur = startKey;
    let guard = 0;
    while (guard++ < w * h * 4 + 8) {
      const list = edges.get(cur);
      if (!list || list.length === 0) break;
      // Prefer the edge that turns right-most to keep rings simple at pinch points.
      const next = list.length === 1 ? list.pop()! : pickTurn(ring, toPoint(cur), list, toPoint);
      ring.push(toPoint(cur));
      cur = next;
      if (cur === startKey) break;
    }
    if (ring.length >= 4) rings.push(collapseCollinear(ring));
  }
  return rings;
}

function pickTurn(ring: Point[], cur: Point, list: number[], toPoint: (k: number) => Point): number {
  const prev = ring[ring.length - 1];
  const inDir = prev ? { x: cur.x - prev.x, y: cur.y - prev.y } : { x: 1, y: 0 };
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const p = toPoint(list[i]!);
    const d = { x: p.x - cur.x, y: p.y - cur.y };
    // Right turn (clockwise in y-down) first: cross < 0.
    const cross = inDir.x * d.y - inDir.y * d.x;
    const score = -cross;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return list.splice(best, 1)[0]!;
}

function collapseCollinear(ring: Point[]): Point[] {
  const out: Point[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!;
    const b = ring[i]!;
    const c = ring[(i + 1) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * Selection → path (Paths panel "Make work path", PS "Tolerance" 0.5..10 px). Traces the
 * thresholded selection outline, simplifies with Douglas-Peucker and, with `smooth`,
 * fits Catmull-Rom tangents as bezier handles.
 */
export function selectionToPath(sel: Selection, tolerance = 2, opts: { smooth?: boolean; name?: string } = {}): Path {
  const rings = traceMaskOutlines(sel.mask, sel.width, sel.height);
  const subpaths: Subpath[] = [];
  for (const ring of rings) {
    const pts = simplifyRing(ring, Math.max(0, tolerance));
    if (pts.length < 3) continue;
    const anchors: Anchor[] = pts.map((p) => anchor(p.x, p.y));
    if (opts.smooth) smoothAnchors(anchors, true);
    subpaths.push({ closed: true, anchors });
  }
  return newPath(opts.name ?? "Work Path", subpaths);
}

/**
 * Give every anchor collinear Catmull-Rom handles (in place): handle = (next − prev) ×
 * `tension` (1/6 is the exact Catmull-Rom → cubic bezier conversion), clamped to half
 * the neighbouring segment lengths so uneven spacing never overshoots.
 */
export function smoothAnchors(anchors: Anchor[], closed: boolean, tension = 1 / 6): void {
  const n = anchors.length;
  for (let i = 0; i < n; i++) {
    const a = anchors[i]!;
    const prev = anchors[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const next = anchors[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const tx = (next.x - prev.x) * tension;
    const ty = (next.y - prev.y) * tension;
    const dIn = Math.hypot(a.x - prev.x, a.y - prev.y);
    const dOut = Math.hypot(next.x - a.x, next.y - a.y);
    const len = Math.hypot(tx, ty);
    if (len === 0) continue;
    const kIn = Math.min(len, dIn / 2) / len;
    const kOut = Math.min(len, dOut / 2) / len;
    a.inX = a.x - tx * kIn;
    a.inY = a.y - ty * kIn;
    a.outX = a.x + tx * kOut;
    a.outY = a.y + ty * kOut;
    a.type = "smooth";
  }
}

// ---------------------------------------------------------------------------
// Hit testing (Pen / Direct Selection tools)
// ---------------------------------------------------------------------------

export interface AnchorHit {
  subpath: number;
  index: number;
  dist: number;
  /** Which part was hit: the anchor itself or one of its handles. */
  part: "anchor" | "in" | "out";
}

/** Nearest anchor (or handle, when `handles`) within `maxDist`, or null. */
export function nearestAnchor(path: Path, pt: Point, maxDist = 6, handles = false): AnchorHit | null {
  let best: AnchorHit | null = null;
  path.subpaths.forEach((sp, si) => {
    sp.anchors.forEach((a, ai) => {
      const consider = (x: number, y: number, part: AnchorHit["part"]): void => {
        const d = Math.hypot(x - pt.x, y - pt.y);
        if (d <= maxDist && (!best || d < best.dist)) best = { subpath: si, index: ai, dist: d, part };
      };
      consider(a.x, a.y, "anchor");
      if (handles) {
        consider(a.inX, a.inY, "in");
        consider(a.outX, a.outY, "out");
      }
    });
  });
  return best;
}

export interface SegmentHit {
  subpath: number;
  /** Segment from anchor `index` to `index + 1` (wrapping to 0 for the closing segment). */
  index: number;
  t: number;
  point: Point;
  dist: number;
}

/** Nearest point on any segment within `maxDist`, or null. */
export function nearestSegment(path: Path, pt: Point, maxDist = 6): SegmentHit | null {
  let best: SegmentHit | null = null;
  const tmp = { x: 0, y: 0 };
  path.subpaths.forEach((sp, si) => {
    const n = sp.anchors.length;
    const segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = sp.anchors[i]!;
      const b = sp.anchors[(i + 1) % n]!;
      // Coarse sample, then refine around the best sample.
      let bt = 0;
      let bd = Infinity;
      const N = isStraight(a, b) ? 8 : 32;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        bezierPoint(a, b, t, tmp);
        const d = Math.hypot(tmp.x - pt.x, tmp.y - pt.y);
        if (d < bd) {
          bd = d;
          bt = t;
        }
      }
      let lo = Math.max(0, bt - 1 / N);
      let hi = Math.min(1, bt + 1 / N);
      for (let it = 0; it < 20; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        bezierPoint(a, b, m1, tmp);
        const d1 = Math.hypot(tmp.x - pt.x, tmp.y - pt.y);
        bezierPoint(a, b, m2, tmp);
        const d2 = Math.hypot(tmp.x - pt.x, tmp.y - pt.y);
        if (d1 < d2) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      bezierPoint(a, b, t, tmp);
      const d = Math.hypot(tmp.x - pt.x, tmp.y - pt.y);
      if (d <= maxDist && (!best || d < best.dist)) best = { subpath: si, index: i, t, point: { x: tmp.x, y: tmp.y }, dist: d };
    }
  });
  return best;
}

/**
 * Insert an anchor on segment `index` of `subpath` at parameter `t` (de Casteljau),
 * preserving the curve's shape. Returns a new path (the input is not mutated).
 */
export function splitSegmentAt(path: Path, subpath: number, index: number, t: number): Path {
  const out = clonePath(path);
  const sp = out.subpaths[subpath];
  if (!sp) return out;
  const n = sp.anchors.length;
  const a = sp.anchors[index];
  const b = sp.anchors[(index + 1) % n];
  if (!a || !b) return out;
  const lerp = (p: Point, q: Point, k: number): Point => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  const p0 = { x: a.x, y: a.y };
  const p1 = { x: a.outX, y: a.outY };
  const p2 = { x: b.inX, y: b.inY };
  const p3 = { x: b.x, y: b.y };
  const straight = isStraight(a, b);
  const q0 = lerp(p0, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  // Straight segments split linearly (the collapsed-handle cubic is not linear in t).
  const m = straight ? lerp(p0, p3, t) : lerp(r0, r1, t);
  a.outX = straight ? a.x : q0.x;
  a.outY = straight ? a.y : q0.y;
  b.inX = straight ? b.x : q2.x;
  b.inY = straight ? b.y : q2.y;
  const mid: Anchor = straight
    ? anchor(m.x, m.y)
    : { x: m.x, y: m.y, inX: r0.x, inY: r0.y, outX: r1.x, outY: r1.y, type: "smooth" };
  sp.anchors.splice(index + 1, 0, mid);
  return out;
}

/** Remove an anchor (returns a new path). Subpaths with fewer than 1 anchor are dropped. */
export function removeAnchor(path: Path, subpath: number, index: number): Path {
  const out = clonePath(path);
  const sp = out.subpaths[subpath];
  if (!sp) return out;
  sp.anchors.splice(index, 1);
  if (sp.anchors.length === 0) out.subpaths.splice(subpath, 1);
  return out;
}
