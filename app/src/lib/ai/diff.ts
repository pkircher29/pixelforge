/**
 * "What did the model touch?" — per-pixel difference between two document-sized
 * rasters, rendered as a magenta overlay. Pure; tested in `tests/ai/diff.test.ts`.
 */

import { Raster } from "$lib/engine";

/** Max per-channel delta (RGBA, 0..255) above which a pixel counts as changed. */
export const DIFF_THRESHOLD = 24;

export interface DiffResult {
  /** Same size as the inputs: magenta where changed, transparent elsewhere. */
  overlay: Raster;
  /** Number of changed pixels. */
  changed: number;
  /** `changed / total`, 0..1. */
  fraction: number;
}

export interface DiffOptions {
  threshold?: number;
  /** Overlay colour, default magenta. */
  color?: { r: number; g: number; b: number };
  /** Overlay alpha for changed pixels, default 160. */
  alpha?: number;
}

/** True when the pixel at index `i` differs by more than `threshold` on any channel. */
export function pixelChanged(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number, threshold: number): boolean {
  return (
    Math.abs(a[i]! - b[i]!) > threshold ||
    Math.abs(a[i + 1]! - b[i + 1]!) > threshold ||
    Math.abs(a[i + 2]! - b[i + 2]!) > threshold ||
    Math.abs(a[i + 3]! - b[i + 3]!) > threshold
  );
}

/** Compute the overlay. Throws when the sizes differ. */
export function diffRasters(before: Raster, after: Raster, opts: DiffOptions = {}): DiffResult {
  if (before.width !== after.width || before.height !== after.height) {
    throw new RangeError(`diffRasters: ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  const threshold = opts.threshold ?? DIFF_THRESHOLD;
  const { r, g, b } = opts.color ?? { r: 255, g: 0, b: 200 };
  const alpha = opts.alpha ?? 160;
  const overlay = new Raster(before.width, before.height);
  const a = before.data;
  const c = after.data;
  const o = overlay.data;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!pixelChanged(a, c, i, threshold)) continue;
    changed++;
    o[i] = r;
    o[i + 1] = g;
    o[i + 2] = b;
    o[i + 3] = alpha;
  }
  const total = before.width * before.height;
  return { overlay, changed, fraction: total === 0 ? 0 : changed / total };
}
