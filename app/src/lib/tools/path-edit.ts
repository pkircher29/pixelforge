/**
 * Pure path-editing operations for the Pen / Path Selection tools (engine `Path`).
 * Every function returns a new path (paths are cloned, never mutated in place).
 */
import { anchor, clonePath, nearestAnchor, newPath, type Anchor, type Path, type Point, type Subpath } from "$lib/engine";

export interface AnchorRef {
  subpath: number;
  index: number;
}

/** Start a new subpath with a corner anchor at `p`. */
export function beginSubpath(path: Path, p: Point): Path {
  const out = clonePath(path);
  out.subpaths.push({ closed: false, anchors: [anchor(p.x, p.y)] });
  return out;
}

/** Append an anchor to the last open subpath (or start one). */
export function appendAnchor(path: Path, p: Point, type: Anchor["type"] = "corner"): Path {
  const out = clonePath(path);
  const sp = out.subpaths[out.subpaths.length - 1];
  if (!sp || sp.closed) out.subpaths.push({ closed: false, anchors: [anchor(p.x, p.y, { type })] });
  else sp.anchors.push(anchor(p.x, p.y, { type }));
  return out;
}

/** Close the last subpath. */
export function closeLastSubpath(path: Path): Path {
  const out = clonePath(path);
  const sp = out.subpaths[out.subpaths.length - 1];
  if (sp && sp.anchors.length >= 2) sp.closed = true;
  return out;
}

/** True when the last subpath is open (the pen can continue it). */
export function lastSubpathOpen(path: Path): boolean {
  const sp = path.subpaths[path.subpaths.length - 1];
  return !!sp && !sp.closed && sp.anchors.length > 0;
}

/**
 * Drag the OUT handle of an anchor to `h` (Pen click-drag). Smooth anchors mirror the
 * IN handle; `breakHandles` (Alt) moves only the out handle and makes it a corner.
 */
export function dragOutHandle(path: Path, ref: AnchorRef, h: Point, breakHandles = false): Path {
  const out = clonePath(path);
  const a = out.subpaths[ref.subpath]?.anchors[ref.index];
  if (!a) return out;
  a.outX = h.x;
  a.outY = h.y;
  if (breakHandles) {
    a.type = "corner";
  } else {
    a.inX = 2 * a.x - h.x;
    a.inY = 2 * a.y - h.y;
    a.type = "smooth";
  }
  return out;
}

/** Move a handle keeping the anchor smooth (collinear, lengths independent) unless `breakHandles`. */
export function moveHandle(path: Path, ref: AnchorRef, which: "in" | "out", h: Point, breakHandles = false): Path {
  const out = clonePath(path);
  const a = out.subpaths[ref.subpath]?.anchors[ref.index];
  if (!a) return out;
  if (which === "out") {
    a.outX = h.x;
    a.outY = h.y;
  } else {
    a.inX = h.x;
    a.inY = h.y;
  }
  if (breakHandles) {
    a.type = "corner";
    return out;
  }
  if (a.type === "smooth") {
    // Keep the opposite handle collinear with its own length.
    const dx = h.x - a.x;
    const dy = h.y - a.y;
    const len = Math.hypot(dx, dy);
    const ox = which === "out" ? a.inX : a.outX;
    const oy = which === "out" ? a.inY : a.outY;
    const olen = Math.hypot(ox - a.x, oy - a.y);
    if (len > 1e-6) {
      const nx = a.x - (dx / len) * olen;
      const ny = a.y - (dy / len) * olen;
      if (which === "out") {
        a.inX = nx;
        a.inY = ny;
      } else {
        a.outX = nx;
        a.outY = ny;
      }
    }
  }
  return out;
}

/** Move an anchor (and its handles) by a delta. */
export function moveAnchor(path: Path, ref: AnchorRef, dx: number, dy: number): Path {
  const out = clonePath(path);
  const a = out.subpaths[ref.subpath]?.anchors[ref.index];
  if (!a) return out;
  a.x += dx;
  a.y += dy;
  a.inX += dx;
  a.inY += dy;
  a.outX += dx;
  a.outY += dy;
  return out;
}

/** Move several anchors by a delta. */
export function moveAnchors(path: Path, refs: readonly AnchorRef[], dx: number, dy: number): Path {
  let out = path;
  for (const r of refs) out = moveAnchor(out, r, dx, dy);
  return out;
}

/** Move a whole subpath. */
export function moveSubpath(path: Path, subpath: number, dx: number, dy: number): Path {
  const out = clonePath(path);
  const sp = out.subpaths[subpath];
  if (!sp) return out;
  for (const a of sp.anchors) {
    a.x += dx;
    a.y += dy;
    a.inX += dx;
    a.inY += dy;
    a.outX += dx;
    a.outY += dy;
  }
  return out;
}

/**
 * Convert Point tool: smooth → corner (handles retracted) and corner → smooth (handles
 * extended along the neighbouring segments).
 */
export function convertAnchor(path: Path, ref: AnchorRef): Path {
  const out = clonePath(path);
  const sp = out.subpaths[ref.subpath];
  const a = sp?.anchors[ref.index];
  if (!sp || !a) return out;
  const hasHandles = Math.hypot(a.inX - a.x, a.inY - a.y) > 0.5 || Math.hypot(a.outX - a.x, a.outY - a.y) > 0.5;
  if (a.type === "smooth" || hasHandles) {
    a.type = "corner";
    a.inX = a.outX = a.x;
    a.inY = a.outY = a.y;
    return out;
  }
  const n = sp.anchors.length;
  const prev = sp.anchors[(ref.index - 1 + n) % n]!;
  const next = sp.anchors[(ref.index + 1) % n]!;
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const len = Math.hypot(tx, ty) || 1;
  const d = Math.min(Math.hypot(next.x - a.x, next.y - a.y), Math.hypot(prev.x - a.x, prev.y - a.y)) / 3;
  a.type = "smooth";
  a.outX = a.x + (tx / len) * d;
  a.outY = a.y + (ty / len) * d;
  a.inX = a.x - (tx / len) * d;
  a.inY = a.y - (ty / len) * d;
  return out;
}

/** Delete an anchor; subpaths that drop below 2 anchors are removed. */
export function deleteAnchor(path: Path, ref: AnchorRef): Path {
  const out = clonePath(path);
  const sp = out.subpaths[ref.subpath];
  if (!sp) return out;
  sp.anchors.splice(ref.index, 1);
  if (sp.anchors.length < 2) out.subpaths.splice(ref.subpath, 1);
  return out;
}

export function deleteAnchors(path: Path, refs: readonly AnchorRef[]): Path {
  // Delete from the highest index down so earlier refs stay valid.
  const sorted = [...refs].sort((a, b) => b.subpath - a.subpath || b.index - a.index);
  let out = path;
  for (const r of sorted) out = deleteAnchor(out, r);
  return out;
}

/** Anchors whose position falls inside a rect (marquee select). */
export function anchorsInRect(path: Path, r: { x: number; y: number; w: number; h: number }): AnchorRef[] {
  const out: AnchorRef[] = [];
  path.subpaths.forEach((sp, si) => sp.anchors.forEach((a, ai) => {
    if (a.x >= r.x && a.y >= r.y && a.x <= r.x + r.w && a.y <= r.y + r.h) out.push({ subpath: si, index: ai });
  }));
  return out;
}

/** Handle hit test: which handle of which anchor is within `maxDist` of `pt`. */
export function hitHandle(path: Path, pt: Point, maxDist: number, only?: readonly AnchorRef[]): { ref: AnchorRef; which: "in" | "out" } | null {
  let best: { ref: AnchorRef; which: "in" | "out"; d: number } | null = null;
  for (let si = 0; si < path.subpaths.length; si++) {
    const sp = path.subpaths[si]!;
    for (let ai = 0; ai < sp.anchors.length; ai++) {
      if (only && !only.some((r) => r.subpath === si && r.index === ai)) continue;
      const a = sp.anchors[ai]!;
      const dIn = Math.hypot(a.inX - pt.x, a.inY - pt.y);
      const dOut = Math.hypot(a.outX - pt.x, a.outY - pt.y);
      if (dOut <= maxDist && (!best || dOut < best.d)) best = { ref: { subpath: si, index: ai }, which: "out", d: dOut };
      if (dIn <= maxDist && (!best || dIn < best.d)) best = { ref: { subpath: si, index: ai }, which: "in", d: dIn };
    }
  }
  return best ? { ref: best.ref, which: best.which } : null;
}

/** Anchor hit test wrapper returning an `AnchorRef`. */
export function hitAnchor(path: Path, pt: Point, maxDist: number): AnchorRef | null {
  const h = nearestAnchor(path, pt, maxDist);
  return h ? { subpath: h.subpath, index: h.index } : null;
}

/** Fit a freehand polyline with smooth anchors (Freeform Pen). */
export function fitFreehand(points: readonly Point[], tolerance: number, closed: boolean, name = "Work Path"): Subpath {
  const pts = simplify(points, tolerance);
  const anchors = pts.map((p) => anchor(p.x, p.y, { type: "smooth" }));
  const n = anchors.length;
  for (let i = 0; i < n; i++) {
    const a = anchors[i]!;
    const prev = anchors[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const next = anchors[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const dIn = Math.hypot(a.x - prev.x, a.y - prev.y) / 3;
    const dOut = Math.hypot(next.x - a.x, next.y - a.y) / 3;
    const len = Math.hypot(tx, ty) || 1;
    a.inX = a.x - (tx / len) * dIn;
    a.inY = a.y - (ty / len) * dIn;
    a.outX = a.x + (tx / len) * dOut;
    a.outY = a.y + (ty / len) * dOut;
  }
  void name;
  return { closed, anchors };
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    let far = -1;
    let maxD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(points[i]!, pa, pb);
      if (d > maxD) {
        maxD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Fresh work path. */
export function emptyWorkPath(): Path {
  return newPath("Work Path", []);
}
