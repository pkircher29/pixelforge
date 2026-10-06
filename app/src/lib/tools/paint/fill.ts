/**
 * Fill helpers: paint a colour through a coverage mask, and linear / radial gradients.
 * All functions write into a layer raster in place and return the raster-space rect
 * touched (null when nothing changed). Callers wrap them in a PaintCommand.
 */
import { Rect, type Point, type Raster, type RGBA, type Selection } from "$lib/engine";

/**
 * Composite `color` over the raster wherever `mask` (doc-space) has coverage.
 * `offset` is the layer's document offset. `opacity` 0..1 scales the mask.
 */
export function fillThroughMask(raster: Raster, mask: Selection, offset: Point, color: RGBA, opacity = 1): Rect | null {
  const bb = mask.bbox;
  if (!bb) return null;
  const area = Rect.intersect(Rect.translate(bb, -offset.x, -offset.y), raster.bounds());
  if (Rect.isEmpty(area)) return null;
  const d = raster.data;
  const w = raster.width;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const m = mask.get(x + offset.x, y + offset.y);
      if (m === 0) continue;
      const sa = (m / 255) * opacity * (color.a / 255);
      if (sa <= 0) continue;
      const p = (y * w + x) * 4;
      over(d, p, color.r, color.g, color.b, sa);
    }
  }
  return area;
}

/** Erase (alpha → 0) through a mask. */
export function clearThroughMask(raster: Raster, mask: Selection, offset: Point): Rect | null {
  const bb = mask.bbox;
  if (!bb) return null;
  const area = Rect.intersect(Rect.translate(bb, -offset.x, -offset.y), raster.bounds());
  if (Rect.isEmpty(area)) return null;
  const d = raster.data;
  const w = raster.width;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const m = mask.get(x + offset.x, y + offset.y);
      if (m === 0) continue;
      const p = (y * w + x) * 4 + 3;
      d[p] = d[p]! * (1 - m / 255);
    }
  }
  return area;
}

export type GradientType = "linear" | "radial";

/**
 * Gradient from `a` (colour `c0`) to `b` (colour `c1`), both in raster space. When
 * `clip` is given (doc-space selection, non-empty) only selected pixels are written.
 */
export function renderGradient(
  raster: Raster,
  a: Point,
  b: Point,
  c0: RGBA,
  c1: RGBA,
  type: GradientType,
  opts: { clip?: Selection | null; offset?: Point; opacity?: number; dither?: boolean } = {},
): Rect | null {
  const clip = opts.clip && !opts.clip.isEmpty ? opts.clip : null;
  const off = opts.offset ?? { x: 0, y: 0 };
  const opacity = opts.opacity ?? 1;
  let area = raster.bounds();
  if (clip) {
    const bb = clip.bbox!;
    area = Rect.intersect(Rect.translate(bb, -off.x, -off.y), area);
  }
  if (Rect.isEmpty(area)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const d = raster.data;
  const w = raster.width;
  const dither = opts.dither ?? true;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      let m = 1;
      if (clip) {
        m = clip.get(x + off.x, y + off.y) / 255;
        if (m === 0) continue;
      }
      let t: number;
      if (len2 === 0) t = 1;
      else if (type === "linear") t = ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2;
      else t = Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y) / Math.sqrt(len2);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (dither) t = Math.min(1, Math.max(0, t + (hash(x, y) - 0.5) / 255));
      const r = c0.r + (c1.r - c0.r) * t;
      const g = c0.g + (c1.g - c0.g) * t;
      const bl = c0.b + (c1.b - c0.b) * t;
      const al = (c0.a + (c1.a - c0.a) * t) / 255;
      const sa = al * m * opacity;
      if (sa <= 0) continue;
      over(d, (y * w + x) * 4, r, g, bl, sa);
    }
  }
  return area;
}

/** Cheap 2-D hash in [0,1) for ordered-looking dither. */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Straight-alpha "over" of (r,g,b,sa) onto `d[p..p+3]`. */
function over(d: Uint8ClampedArray, p: number, r: number, g: number, b: number, sa: number): void {
  const ba = d[p + 3]! / 255;
  const ao = sa + ba * (1 - sa);
  if (ao <= 0) return;
  const ws = sa / ao;
  const wd = (ba * (1 - sa)) / ao;
  d[p] = r * ws + d[p]! * wd;
  d[p + 1] = g * ws + d[p + 1]! * wd;
  d[p + 2] = b * ws + d[p + 2]! * wd;
  d[p + 3] = ao * 255;
}
