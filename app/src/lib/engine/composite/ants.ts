/**
 * CPU helpers for the selection outline. The GL compositor uploads the thresholded mask
 * and finds the edge in screen space; the Canvas fallback draws the edge pixels found by
 * `computeSelectionEdge`.
 */

import type { Selection } from "../selection";

/** Write a 0/255 binary version of the selection into `out` (length `w*h`). */
export function thresholdMask(sel: Selection, out: Uint8Array, threshold = 128): Uint8Array {
  const m = sel.mask;
  for (let i = 0; i < m.length; i++) out[i] = m[i]! >= threshold ? 255 : 0;
  return out;
}

/**
 * Packed indices (`y * width + x`) of selected pixels that have at least one 4-connected
 * neighbour that is unselected (or lies outside the canvas): the inner boundary.
 */
export function computeSelectionEdge(sel: Selection, threshold = 128): Int32Array {
  const bb = sel.bbox;
  if (!bb) return new Int32Array(0);
  const w = sel.width;
  const h = sel.height;
  const m = sel.mask;
  let out = new Int32Array(Math.max(16, (bb.w + bb.h) * 4));
  let n = 0;
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    const row = y * w;
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const i = row + x;
      if (m[i]! < threshold) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        m[i - 1]! < threshold ||
        m[i + 1]! < threshold ||
        m[i - w]! < threshold ||
        m[i + w]! < threshold;
      if (!edge) continue;
      if (n === out.length) {
        const bigger = new Int32Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[n++] = i;
    }
  }
  return out.subarray(0, n);
}
