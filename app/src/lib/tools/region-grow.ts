/**
 * Quick Selection growth: flood from brush-covered seed pixels through neighbours
 * whose Lab color is close to the seed color and that are not separated by a strong
 * edge. Pure, unit-tested on synthetic images.
 */
import type { Raster } from "$lib/engine";
import type { EdgeMap } from "./edge-map";

/** sRGB → CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number, out: Float32Array = new Float32Array(3), o = 0): Float32Array {
  const lin = (c: number): number => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  out[o] = 116 * y - 16;
  out[o + 1] = 500 * (x - y);
  out[o + 2] = 200 * (y - z);
  return out;
}

/** Lab buffer for a whole raster (3 floats per pixel). */
export function labOf(r: Raster): Float32Array {
  const n = r.width * r.height;
  const out = new Float32Array(n * 3);
  const d = r.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) rgbToLab(d[p]!, d[p + 1]!, d[p + 2]!, out, i * 3);
  return out;
}

export class LabCache {
  private key = "";
  private lab: Float32Array | null = null;
  get(key: string, build: () => Raster): Float32Array {
    if (this.lab && this.key === key) return this.lab;
    this.lab = labOf(build());
    this.key = key;
    return this.lab;
  }
  clear(): void {
    this.lab = null;
    this.key = "";
  }
}

export interface GrowOptions {
  /** ΔE threshold (default 14; adapted upward with seed variance). */
  tolerance?: number;
  /** Edge magnitude above which growth stops (default 0.25 × edge.max). */
  edgeStop?: number;
  /** Hard pixel budget. */
  maxPixels?: number;
}

/**
 * Grow from `seeds` (pixel indices) into `region` (Uint8Array, 255 = selected; mutated).
 * Returns the number of pixels added.
 */
export function growRegion(lab: Float32Array, w: number, h: number, edge: EdgeMap | null, seeds: readonly number[], region: Uint8Array, opts: GrowOptions = {}): number {
  if (seeds.length === 0) return 0;
  // Seed statistics (mean + spread) drive an adaptive tolerance.
  const mean = [0, 0, 0];
  for (const i of seeds) for (let c = 0; c < 3; c++) mean[c]! += lab[i * 3 + c]!;
  for (let c = 0; c < 3; c++) mean[c]! /= seeds.length;
  let spread = 0;
  for (const i of seeds) spread += Math.hypot(lab[i * 3]! - mean[0]!, lab[i * 3 + 1]! - mean[1]!, lab[i * 3 + 2]! - mean[2]!);
  spread /= seeds.length;
  const tol = (opts.tolerance ?? 14) + spread * 0.8;
  const edgeStop = opts.edgeStop ?? (edge ? edge.max * 0.25 : Infinity);
  const budget = opts.maxPixels ?? w * h;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const i of seeds) {
    if (!seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  let added = 0;
  const dist = (i: number): number => Math.hypot(lab[i * 3]! - mean[0]!, lab[i * 3 + 1]! - mean[1]!, lab[i * 3 + 2]! - mean[2]!);
  while (stack.length && added < budget) {
    const i = stack.pop()!;
    if (region[i] !== 255) {
      region[i] = 255;
      added++;
    }
    const x = i % w;
    const y = (i - x) / w;
    const tryPush = (j: number): void => {
      if (seen[j]) return;
      seen[j] = 1;
      if (dist(j) > tol) return;
      if (edge && edge.mag[j]! > edgeStop) {
        // On a strong edge: take the pixel (it matches) but don't grow past it.
        if (region[j] !== 255) {
          region[j] = 255;
          added++;
        }
        return;
      }
      stack.push(j);
    };
    if (x > 0) tryPush(i - 1);
    if (x < w - 1) tryPush(i + 1);
    if (y > 0) tryPush(i - w);
    if (y < h - 1) tryPush(i + w);
  }
  return added;
}

/** Remove from `region` the pixels reachable from `seeds` that are similar to the seed color. */
export function shrinkRegion(lab: Float32Array, w: number, h: number, seeds: readonly number[], region: Uint8Array, opts: GrowOptions = {}): number {
  const tmp = new Uint8Array(w * h);
  growRegion(lab, w, h, null, seeds, tmp, { ...opts, tolerance: opts.tolerance ?? 10 });
  let removed = 0;
  for (let i = 0; i < tmp.length; i++) {
    if (tmp[i] && region[i]) {
      region[i] = 0;
      removed++;
    }
  }
  return removed;
}

/** Pixel indices under a disc of `radius` around (cx, cy). */
export function discIndices(w: number, h: number, cx: number, cy: number, radius: number): number[] {
  const out: number[] = [];
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) out.push(y * w + x);
  return out;
}

/**
 * Auto-enhance: smooth the region boundary (3×3 majority) so selections don't look
 * pixel-jagged. Returns a new array.
 */
export function enhanceRegion(region: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(region);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          n++;
          if (region[yy * w + xx]) on++;
        }
      }
      out[y * w + x] = on * 2 > n ? 255 : 0;
    }
  }
  return out;
}
