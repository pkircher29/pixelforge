/** Shape geometry (pure): polygon / star, line with arrowheads, rounded rect, normalisation of custom shapes. */
import { anchor, type Path, type Point, type Rect, type Subpath } from "$lib/engine";

let shapeSeq = 0;
export function shapeId(): string {
  shapeSeq++;
  return `shape_${Date.now().toString(36)}_${shapeSeq}`;
}

/** Regular polygon or star centred at `c` with circumradius `r`; `indent` 0..99 % (star). */
export function starPoints(c: Point, r: number, sides: number, opts: { star?: boolean; indent?: number; rotation?: number } = {}): Point[] {
  const n = Math.max(3, Math.round(sides));
  const rot = ((opts.rotation ?? -90) * Math.PI) / 180;
  const inner = opts.star ? r * (1 - Math.max(1, Math.min(99, opts.indent ?? 50)) / 100) : r;
  const pts: Point[] = [];
  const count = opts.star ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = rot + (i / count) * Math.PI * 2;
    const rr = opts.star && i % 2 === 1 ? inner : r;
    pts.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr });
  }
  return pts;
}

export function polygonShape(c: Point, r: number, sides: number, opts: { star?: boolean; indent?: number; rotation?: number } = {}): Path {
  return { id: shapeId(), name: opts.star ? "Star" : "Polygon", subpaths: [{ closed: true, anchors: starPoints(c, r, sides, opts).map((p) => anchor(p.x, p.y)) }] };
}

/** Line of `weight` px from a to b as a closed polygon, with optional arrowheads (PS width/length %). */
export function linePolygon(a: Point, b: Point, weight: number, opts: { start?: boolean; end?: boolean; width?: number; length?: number; concavity?: number } = {}): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const hw = Math.max(0.5, weight) / 2;
  const aw = (weight * (opts.width ?? 500)) / 100 / 2;
  const al = (weight * (opts.length ?? 1000)) / 100;
  const conc = ((opts.concavity ?? 0) / 100) * al;
  const startLen = opts.start ? al : 0;
  const endLen = opts.end ? al : 0;
  // Shaft endpoints (shortened where arrowheads sit).
  const s = { x: a.x + ux * startLen, y: a.y + uy * startLen };
  const e = { x: b.x - ux * endLen, y: b.y - uy * endLen };
  const pts: Point[] = [];
  const side = (p: Point, k: number): Point => ({ x: p.x + nx * hw * k, y: p.y + ny * hw * k });
  pts.push(side(s, 1));
  pts.push(side(e, 1));
  if (opts.end) {
    pts.push({ x: e.x + nx * aw - ux * conc, y: e.y + ny * aw - uy * conc });
    pts.push({ x: b.x, y: b.y });
    pts.push({ x: e.x - nx * aw - ux * conc, y: e.y - ny * aw - uy * conc });
  }
  pts.push(side(e, -1));
  pts.push(side(s, -1));
  if (opts.start) {
    pts.push({ x: s.x - nx * aw + ux * conc, y: s.y - ny * aw + uy * conc });
    pts.push({ x: a.x, y: a.y });
    pts.push({ x: s.x + nx * aw + ux * conc, y: s.y + ny * aw + uy * conc });
  }
  return pts;
}

export function lineShape(a: Point, b: Point, weight: number, opts: Parameters<typeof linePolygon>[3] = {}): Path {
  return { id: shapeId(), name: "Line", subpaths: [{ closed: true, anchors: linePolygon(a, b, weight, opts).map((p) => anchor(p.x, p.y)) }] };
}

/** Bounding box of a path's anchors (handles ignored). */
export function anchorBounds(path: Path): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const sp of path.subpaths) {
    for (const a of sp.anchors) {
      x0 = Math.min(x0, a.x, a.inX, a.outX);
      y0 = Math.min(y0, a.y, a.inY, a.outY);
      x1 = Math.max(x1, a.x, a.inX, a.outX);
      y1 = Math.max(y1, a.y, a.inY, a.outY);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Map a unit-square (0..1) path into `rect`. */
export function fitPathToRect(unit: Path, rect: Rect, name?: string): Path {
  const subpaths: Subpath[] = unit.subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({
      x: rect.x + a.x * rect.w,
      y: rect.y + a.y * rect.h,
      inX: rect.x + a.inX * rect.w,
      inY: rect.y + a.inY * rect.h,
      outX: rect.x + a.outX * rect.w,
      outY: rect.y + a.outY * rect.h,
      type: a.type,
    })),
  }));
  return { id: shapeId(), name: name ?? unit.name, subpaths };
}

/**
 * Parse a tiny SVG-like path language into a unit-square path: `M x y`, `L x y`,
 * `C x1 y1 x2 y2 x y`, `Q x1 y1 x y`, `Z`. Coordinates are 0..100 (normalised to 0..1).
 */
export function parseShapeData(d: string, name = "Shape"): Path {
  const tokens = d.trim().split(/[\s,]+/);
  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  let i = 0;
  const num = (): number => Number(tokens[i++]) / 100;
  let cmd = "";
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[MLCQZ]$/i.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") {
        if (cur) cur.closed = true;
        continue;
      }
    }
    if (cmd === "M") {
      cur = { closed: false, anchors: [anchor(num(), num())] };
      subpaths.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      cur?.anchors.push(anchor(num(), num()));
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      if (cur) {
        const prev = cur.anchors[cur.anchors.length - 1]!;
        prev.outX = x1;
        prev.outY = y1;
        if (prev.type === "corner" && (Math.abs(prev.inX - prev.x) > 1e-9 || Math.abs(prev.inY - prev.y) > 1e-9)) prev.type = "smooth";
        cur.anchors.push(anchor(x, y, { inX: x2, inY: y2, type: "smooth" }));
      }
    } else if (cmd === "Q") {
      const qx = num();
      const qy = num();
      const x = num();
      const y = num();
      if (cur) {
        const prev = cur.anchors[cur.anchors.length - 1]!;
        prev.outX = prev.x + (2 / 3) * (qx - prev.x);
        prev.outY = prev.y + (2 / 3) * (qy - prev.y);
        cur.anchors.push(anchor(x, y, { inX: x + (2 / 3) * (qx - x), inY: y + (2 / 3) * (qy - y), type: "smooth" }));
      }
    } else {
      i++;
    }
  }
  // Closing anchors that duplicate the first point are dropped (the closed flag covers it).
  for (const sp of subpaths) {
    const f = sp.anchors[0];
    const l = sp.anchors[sp.anchors.length - 1];
    if (sp.closed && f && l && sp.anchors.length > 2 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
      f.inX = l.inX;
      f.inY = l.inY;
      sp.anchors.pop();
    }
  }
  return { id: shapeId(), name, subpaths };
}

/** Rect from a drag with Shift (square) / Alt (from centre) constraints. */
export function shapeDragRect(anchorPt: Point, cur: Point, square: boolean, fromCenter: boolean): Rect {
  let dx = cur.x - anchorPt.x;
  let dy = cur.y - anchorPt.y;
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (fromCenter) return { x: anchorPt.x - Math.abs(dx), y: anchorPt.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return { x: Math.min(anchorPt.x, anchorPt.x + dx), y: Math.min(anchorPt.y, anchorPt.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}
