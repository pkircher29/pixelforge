/**
 * Integer-friendly axis-aligned rectangle helpers.
 *
 * A `Rect` is `{ x, y, w, h }` with the origin at the top-left. The type and the helper
 * namespace share the name `Rect` (TypeScript declaration merging) so callers write
 * `Rect.intersect(a, b)` and annotate with `: Rect`.
 */

/** Axis-aligned rectangle, origin top-left, in pixels (doc or raster space). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 2-D point. */
export interface Point {
  x: number;
  y: number;
}

/** Helper namespace for {@link Rect}. All functions are pure and return new objects. */
export const Rect = {
  /** Construct a rect. */
  make(x: number, y: number, w: number, h: number): Rect {
    return { x, y, w, h };
  },

  /** The empty rect at the origin. */
  empty(): Rect {
    return { x: 0, y: 0, w: 0, h: 0 };
  },

  /** A rect covering `0,0 .. w,h`. */
  ofSize(w: number, h: number): Rect {
    return { x: 0, y: 0, w, h };
  },

  /** True when the rect has no area. */
  isEmpty(r: Rect | null | undefined): boolean {
    return !r || r.w <= 0 || r.h <= 0;
  },

  /** Area in pixels (0 for empty rects). */
  area(r: Rect): number {
    return Rect.isEmpty(r) ? 0 : r.w * r.h;
  },

  /** Structural equality. */
  equals(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  },

  /** Intersection of two rects; an empty rect (w/h 0) if they do not overlap. */
  intersect(a: Rect, b: Rect): Rect {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    if (x1 <= x0 || y1 <= y0) return { x: x0, y: y0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  /** Smallest rect containing both. Empty inputs are ignored. */
  union(a: Rect | null, b: Rect | null): Rect {
    if (Rect.isEmpty(a)) return Rect.isEmpty(b) ? Rect.empty() : { ...(b as Rect) };
    if (Rect.isEmpty(b)) return { ...(a as Rect) };
    const ra = a as Rect;
    const rb = b as Rect;
    const x0 = Math.min(ra.x, rb.x);
    const y0 = Math.min(ra.y, rb.y);
    const x1 = Math.max(ra.x + ra.w, rb.x + rb.w);
    const y1 = Math.max(ra.y + ra.h, rb.y + rb.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  /** Clamp `r` so it lies inside `bounds` (alias of intersect with clearer intent). */
  clamp(r: Rect, bounds: Rect): Rect {
    return Rect.intersect(r, bounds);
  },

  /** True when the point lies inside the rect (half-open on the right/bottom). */
  containsPoint(r: Rect, x: number, y: number): boolean {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  },

  /** True when `inner` is completely inside `outer`. */
  contains(outer: Rect, inner: Rect): boolean {
    return (
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.w <= outer.x + outer.w &&
      inner.y + inner.h <= outer.y + outer.h
    );
  },

  /** Grow (or shrink with negative `px`) on every side. */
  inflate(r: Rect, px: number): Rect {
    return { x: r.x - px, y: r.y - px, w: r.w + px * 2, h: r.h + px * 2 };
  },

  /** Move by a delta. */
  translate(r: Rect, dx: number, dy: number): Rect {
    return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
  },

  /** The smallest integer-aligned rect fully covering a fractional rect. */
  roundOut(r: Rect): Rect {
    const x0 = Math.floor(r.x);
    const y0 = Math.floor(r.y);
    const x1 = Math.ceil(r.x + r.w);
    const y1 = Math.ceil(r.y + r.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  /** Rect spanning two corner points (any order). */
  fromPoints(a: Point, b: Point): Rect {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  },

  /** Bounding rect of a list of points (empty rect when the list is empty). */
  boundingPoints(points: readonly Point[]): Rect {
    if (points.length === 0) return Rect.empty();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },
};
