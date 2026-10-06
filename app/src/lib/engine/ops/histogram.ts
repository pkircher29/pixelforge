/**
 * 256-bin RGB + luma histogram and the Levels "Auto" computation.
 */

import { Rect } from "../rect";
import type { Raster } from "../raster";
import { LUMA_B, LUMA_G, LUMA_R } from "./cpu";
import type { Histogram } from "./types";

export function computeHistogram(src: Raster, rect?: Rect): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  const area = rect ? Rect.intersect(rect, src.bounds()) : src.bounds();
  let count = 0;
  const d = src.data;
  const w = src.width;
  for (let y = area.y; y < area.y + area.h; y++) {
    let i = (y * w + area.x) * 4;
    for (let x = 0; x < area.w; x++, i += 4) {
      if (d[i + 3] === 0) continue;
      const pr = d[i]!;
      const pg = d[i + 1]!;
      const pb = d[i + 2]!;
      r[pr]!++;
      g[pg]!++;
      b[pb]!++;
      l[Math.round(pr * LUMA_R + pg * LUMA_G + pb * LUMA_B)]!++;
      count++;
    }
  }
  return { r, g, b, l, count };
}

/**
 * Input black / white points that clip `clipFraction` of pixels at each end of a channel
 * histogram (Photoshop's "Enhance Per Channel Contrast" default is 0.1 %).
 */
export function autoLevelsForChannel(bins: Uint32Array, count: number, clipFraction = 0.001): { black: number; white: number } {
  if (count === 0) return { black: 0, white: 255 };
  const clip = count * clipFraction;
  let acc = 0;
  let black = 0;
  for (let i = 0; i < 256; i++) {
    acc += bins[i]!;
    if (acc > clip) {
      black = i;
      break;
    }
  }
  acc = 0;
  let white = 255;
  for (let i = 255; i >= 0; i--) {
    acc += bins[i]!;
    if (acc > clip) {
      white = i;
      break;
    }
  }
  if (white <= black) {
    black = Math.max(0, Math.min(black, 253));
    white = black + 2;
  }
  return { black, white };
}

/** Peak bin value (for normalised drawing); ignores the 0 and 255 bins' dominance when `trimEnds`. */
export function histogramPeak(bins: Uint32Array, trimEnds = true): number {
  let peak = 0;
  const lo = trimEnds ? 1 : 0;
  const hi = trimEnds ? 255 : 256;
  for (let i = lo; i < hi; i++) if (bins[i]! > peak) peak = bins[i]!;
  if (peak === 0) for (let i = 0; i < 256; i++) if (bins[i]! > peak) peak = bins[i]!;
  return Math.max(1, peak);
}
