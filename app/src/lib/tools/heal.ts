/**
 * Healing math ("Poisson-lite"): clone a source patch into a destination region and
 * match its mean / variance per channel to the destination's boundary ring, blended
 * with a feathered mask. Pure, raster-in / raster-out, unit-tested.
 */
import { Raster, Rect, type Point } from "$lib/engine";

export interface ChannelStats {
  mean: [number, number, number];
  std: [number, number, number];
  count: number;
}

/** Mean / std of RGB over pixels where `weight(x, y) > 0` (weighted). */
export function regionStats(r: Raster, rect: Rect, weight: (x: number, y: number) => number): ChannelStats {
  const d = r.data;
  const w = r.width;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  const x1 = Math.min(r.width, rect.x + rect.w);
  const y1 = Math.min(r.height, rect.y + rect.h);
  for (let y = Math.max(0, rect.y); y < y1; y++) {
    for (let x = Math.max(0, rect.x); x < x1; x++) {
      const k = weight(x, y);
      if (k <= 0) continue;
      const p = (y * w + x) * 4;
      if (d[p + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = d[p + c]!;
        sum[c]! += v * k;
        sq[c]! += v * v * k;
      }
      n += k;
    }
  }
  if (n <= 0) return { mean: [0, 0, 0], std: [1, 1, 1], count: 0 };
  const mean = sum.map((s) => s / n) as [number, number, number];
  const std = sq.map((s, i) => Math.sqrt(Math.max(0, s / n - mean[i]! * mean[i]!))) as [number, number, number];
  return { mean, std, count: n };
}

/** Boundary ring of a coverage mask: dilate by `width` minus the mask itself (weights 0..1). */
export function ringMask(mask: Float32Array, w: number, h: number, rect: Rect, width: number): Float32Array {
  const out = new Float32Array(w * h);
  const r = Math.max(1, Math.round(width));
  const x0 = Math.max(0, rect.x - r);
  const y0 = Math.max(0, rect.y - r);
  const x1 = Math.min(w, rect.x + rect.w + r);
  const y1 = Math.min(h, rect.y + rect.h + r);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (mask[i]! >= 0.5) continue;
      let near = 0;
      for (let dy = -r; dy <= r && near < 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (dx * dx + dy * dy > r * r) continue;
          const m = mask[yy * w + xx]!;
          if (m >= 0.5) {
            near = 1;
            break;
          }
        }
      }
      out[i] = near;
    }
  }
  return out;
}

/** Bounding rect of a coverage mask (threshold 0.01), or null. */
export function maskBounds(mask: Float32Array, w: number, h: number): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]! > 0.01) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Sum of squared differences between two rects of a raster, sampled every `step` px over ring weights. */
function ringSsd(r: Raster, a: Rect, b: Rect, ring: Float32Array, mask: Float32Array, step: number): number {
  const d = r.data;
  const w = r.width;
  const h = r.height;
  let ssd = 0;
  let n = 0;
  const pad = Math.ceil((a.w + a.h) / 8);
  for (let y = -pad; y < a.h + pad; y += step) {
    for (let x = -pad; x < a.w + pad; x += step) {
      const ax = a.x + x;
      const ay = a.y + y;
      const bx = b.x + x;
      const by = b.y + y;
      if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
      const ai = ay * w + ax;
      if (ring[ai]! <= 0) continue;
      if (bx < 0 || by < 0 || bx >= w || by >= h) return Infinity;
      if (mask[by * w + bx]! > 0.01) return Infinity; // candidate overlaps the hole
      const p = ai * 4;
      const q = (by * w + bx) * 4;
      if (d[q + 3] === 0) return Infinity;
      for (let c = 0; c < 3; c++) {
        const dd = d[p + c]! - d[q + c]!;
        ssd += dd * dd;
      }
      n++;
    }
  }
  return n === 0 ? Infinity : ssd / n;
}

/**
 * Spot Healing source search: try candidate offsets on rings around the hole and keep
 * the one whose surroundings match the destination ring best (SSD on a sparse grid).
 */
export function findHealSource(r: Raster, mask: Float32Array, bounds: Rect, ring: Float32Array, opts: { radii?: number[]; directions?: number } = {}): Point {
  const size = Math.max(bounds.w, bounds.h);
  const radii = opts.radii ?? [size * 1.2, size * 1.8, size * 2.6, size * 3.6];
  const dirs = opts.directions ?? 16;
  const step = Math.max(1, Math.round(size / 24));
  let best: Point = { x: 0, y: 0 };
  let bestScore = Infinity;
  for (const rad of radii) {
    for (let k = 0; k < dirs; k++) {
      const a = (k / dirs) * Math.PI * 2;
      const dx = Math.round(Math.cos(a) * rad);
      const dy = Math.round(Math.sin(a) * rad);
      const cand = Rect.translate(bounds, dx, dy);
      if (cand.x < 0 || cand.y < 0 || cand.x + cand.w > r.width || cand.y + cand.h > r.height) continue;
      const s = ringSsd(r, bounds, cand, ring, mask, step);
      if (s < bestScore) {
        bestScore = s;
        best = { x: dx, y: dy };
      }
    }
    if (bestScore < 60) break; // good enough; nearer textures look more natural
  }
  return best;
}

/** Soft mask: blur the coverage so the heal feathers into its surroundings. */
export function featherMask(mask: Float32Array, w: number, h: number, rect: Rect, radius: number): Float32Array {
  const out = new Float32Array(mask);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return out;
  const tmp = new Float32Array(w * h);
  const x0 = Math.max(0, rect.x - r);
  const y0 = Math.max(0, rect.y - r);
  const x1 = Math.min(w, rect.x + rect.w + r);
  const y1 = Math.min(h, rect.y + rect.h + r);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += mask[y * w + xx]!;
      }
      tmp[y * w + x] = s / (2 * r + 1);
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x]!;
      }
      out[y * w + x] = s / (2 * r + 1);
    }
  }
  return out;
}

export interface HealOptions {
  /** Ring width used for statistics (px). Default: ~15 % of the hole size, ≥ 3. */
  ringWidth?: number;
  /** Feather radius px (default ring/2). */
  feather?: number;
  /** Mode: "normal" matches mean+variance; "replace" clones only. */
  mode?: "normal" | "replace";
  /** Scale the clone's contrast match (0 = mean only). Default 1. */
  varianceMatch?: number;
}

/**
 * Heal the hole described by `mask` (coverage 0..1, raster-sized) in `dst`, copying
 * from `src` at `offset` (source pixel = dest pixel + offset) and matching the clone's
 * mean / std per channel to the destination ring. Writes into `dst` in place; returns the
 * rect touched.
 */
export function healRegion(dst: Raster, src: Raster, mask: Float32Array, offset: Point, opts: HealOptions = {}): Rect | null {
  const w = dst.width;
  const h = dst.height;
  const bounds = maskBounds(mask, w, h);
  if (!bounds) return null;
  const size = Math.max(bounds.w, bounds.h);
  const ringW = opts.ringWidth ?? Math.max(3, Math.round(size * 0.15));
  const feather = opts.feather ?? Math.max(1, Math.round(ringW / 2));
  const ring = ringMask(mask, w, h, bounds, ringW);
  const ringRect = Rect.inflate(bounds, ringW);
  const dstStats = regionStats(dst, ringRect, (x, y) => ring[y * w + x]!);
  // Source statistics over the *same ring shape* shifted to the source location.
  const srcStats = regionStats(src, Rect.translate(ringRect, offset.x, offset.y), (x, y) => {
    const sx = x - offset.x;
    const sy = y - offset.y;
    return sx < 0 || sy < 0 || sx >= w || sy >= h ? 0 : ring[sy * w + sx]!;
  });
  const soft = featherMask(mask, w, h, bounds, feather);
  const area = Rect.intersect(Rect.inflate(bounds, feather), Rect.ofSize(w, h));
  const d = dst.data;
  const s = src.data;
  const sw = src.width;
  const sh = src.height;
  const match = opts.mode === "replace" ? 0 : (opts.varianceMatch ?? 1);
  const gain = [0, 1, 2].map((c) => {
    const ss = srcStats.std[c]!;
    const ds = dstStats.std[c]!;
    if (ss < 1e-3) return 1;
    return Math.min(3, Math.max(0.33, 1 + (ds / ss - 1) * match));
  });
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const i = y * w + x;
      const k = Math.min(1, soft[i]!);
      if (k <= 0.002) continue;
      const sx = x + offset.x;
      const sy = y + offset.y;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const p = i * 4;
      const q = (sy * sw + sx) * 4;
      const sa = s[q + 3]! / 255;
      if (sa <= 0) continue;
      for (let c = 0; c < 3; c++) {
        let v = s[q + c]!;
        if (match > 0) v = (v - srcStats.mean[c]!) * gain[c]! + dstStats.mean[c]! + (srcStats.mean[c]! - dstStats.mean[c]!) * (1 - match);
        v = Math.max(0, Math.min(255, v));
        d[p + c] = d[p + c]! + (v - d[p + c]!) * k;
      }
      d[p + 3] = Math.max(d[p + 3]!, sa * 255 * k);
    }
  }
  return area;
}

/** Coverage mask from a selection-like byte mask (255 = inside) restricted to a raster offset. */
export function maskFromBytes(bytes: Uint8Array, bw: number, bh: number, w: number, h: number, offset: Point): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y + offset.y;
    if (sy < 0 || sy >= bh) continue;
    for (let x = 0; x < w; x++) {
      const sx = x + offset.x;
      if (sx < 0 || sx >= bw) continue;
      out[y * w + x] = bytes[sy * bw + sx]! / 255;
    }
  }
  return out;
}
