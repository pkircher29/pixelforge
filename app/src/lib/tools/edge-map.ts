/**
 * Sobel edge magnitude of a raster's luminance, cached per (document, pixel version).
 * Used by the Magnetic Lasso (snapping) and Quick Selection (edge-aware growth).
 */
import type { Raster } from "$lib/engine";

export interface EdgeMap {
  w: number;
  h: number;
  /** Gradient magnitude per pixel (0..~1442). */
  mag: Float32Array;
  max: number;
}

export function luminanceOf(r: Raster): Float32Array {
  const d = r.data;
  const n = r.width * r.height;
  const out = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = d[p + 3]! / 255;
    out[i] = (0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!) * a;
  }
  return out;
}

/** Sobel magnitude over a luminance buffer. */
export function sobel(lum: Float32Array, w: number, h: number): EdgeMap {
  const mag = new Float32Array(w * h);
  let max = 0;
  const at = (x: number, y: number): number => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const m = Math.hypot(gx, gy);
      mag[y * w + x] = m;
      if (m > max) max = m;
    }
  }
  return { w, h, mag, max };
}

export function edgeMapOf(r: Raster): EdgeMap {
  return sobel(luminanceOf(r), r.width, r.height);
}

/** Cache keyed by an arbitrary string (doc id + pixel version). */
export class EdgeMapCache {
  private key = "";
  private map: EdgeMap | null = null;

  get(key: string, build: () => Raster): EdgeMap {
    if (this.map && this.key === key) return this.map;
    this.map = edgeMapOf(build());
    this.key = key;
    return this.map;
  }

  clear(): void {
    this.map = null;
    this.key = "";
  }
}

/**
 * Strongest edge pixel within `radius` of (x, y) whose magnitude is at least
 * `threshold` (absolute). Prefers nearer pixels when magnitudes tie (distance penalty).
 * Returns null when nothing qualifies.
 */
export function snapToEdge(edge: EdgeMap, x: number, y: number, radius: number, threshold: number): { x: number; y: number; mag: number } | null {
  const r = Math.max(1, Math.round(radius));
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best: { x: number; y: number; mag: number } | null = null;
  let bestScore = -Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= edge.h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= edge.w) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const m = edge.mag[yy * edge.w + xx]!;
      if (m < threshold) continue;
      const score = m * (1 - (0.35 * Math.sqrt(d2)) / r);
      if (score > bestScore) {
        bestScore = score;
        best = { x: xx, y: yy, mag: m };
      }
    }
  }
  return best;
}
