/**
 * Shared CPU building blocks for the ops: per-pixel mapping, premultiplied float
 * conversion, separable Gaussian / box blurs, lookup tables.
 *
 * Everything here is pure TypeScript on typed arrays so it runs in vitest (jsdom has no
 * WebGL) and as the production fallback when WebGL2 is unavailable.
 */

import { Raster } from "$lib/engine";

export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Rec.709 luma of 0..1 channels. */
export function luma(r: number, g: number, b: number): number {
  return r * LUMA_R + g * LUMA_G + b * LUMA_B;
}

/**
 * Map every pixel through `fn(r, g, b, a, out)`. Channels are 0..1 floats; `out` is a
 * scratch `Float32Array(4)` the callback fills (alpha included).
 */
export function mapPixels(
  src: Raster,
  fn: (r: number, g: number, b: number, a: number, out: Float32Array, x: number, y: number) => void,
): Raster {
  const out = new Raster(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const px = new Float32Array(4);
  const w = src.width;
  let i = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      fn(s[i]! / 255, s[i + 1]! / 255, s[i + 2]! / 255, s[i + 3]! / 255, px, x, y);
      d[i] = px[0]! * 255;
      d[i + 1] = px[1]! * 255;
      d[i + 2] = px[2]! * 255;
      d[i + 3] = px[3]! * 255;
    }
  }
  return out;
}

/** Apply a per-channel 256-entry LUT to RGB (alpha untouched). */
export function applyLut(src: Raster, lutR: Uint8ClampedArray, lutG: Uint8ClampedArray, lutB: Uint8ClampedArray): Raster {
  const out = new Raster(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    d[i] = lutR[s[i]!]!;
    d[i + 1] = lutG[s[i + 1]!]!;
    d[i + 2] = lutB[s[i + 2]!]!;
    d[i + 3] = s[i + 3]!;
  }
  return out;
}

/** Build a LUT from a 0..1 -> 0..1 function. */
export function makeLut(fn: (v: number) => number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp01(fn(i / 255)) * 255;
  return lut;
}

/** Premultiplied float copy (RGB * A, A) in 0..255 units. */
export function toPremul(src: Raster): Float32Array {
  const s = src.data;
  const f = new Float32Array(s.length);
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]! / 255;
    f[i] = s[i]! * a;
    f[i + 1] = s[i + 1]! * a;
    f[i + 2] = s[i + 2]! * a;
    f[i + 3] = s[i + 3]!;
  }
  return f;
}

/** Inverse of `toPremul` into a new raster. */
export function fromPremul(f: Float32Array, width: number, height: number): Raster {
  const out = new Raster(width, height);
  const d = out.data;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3]!;
    // Alpha that rounds to 0 stores as fully transparent black (matches the GPU path).
    if (a < 0.5) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    const inv = 255 / a;
    d[i] = f[i]! * inv;
    d[i + 1] = f[i + 1]! * inv;
    d[i + 2] = f[i + 2]! * inv;
    d[i + 3] = a;
  }
  return out;
}

/** Normalised 1-D Gaussian kernel with radius `ceil(3 sigma)` (capped). */
export function gaussianKernel(sigma: number, maxRadius = 1024): Float32Array {
  const half = Math.min(maxRadius, Math.max(1, Math.ceil(sigma * 3)));
  const k = new Float32Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + half] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  return k;
}

/**
 * Convolve a 4-channel float image with a 1-D kernel along x or y (edge clamped).
 * Writes into `dst` (same length as `src`).
 */
export function convolve1d(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  kernel: Float32Array,
  axis: "x" | "y",
): void {
  const half = (kernel.length - 1) >> 1;
  if (axis === "x") {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -half; k <= half; k++) {
          const sx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          const wk = kernel[k + half]!;
          const i = (row + sx) * 4;
          r += src[i]! * wk;
          g += src[i + 1]! * wk;
          b += src[i + 2]! * wk;
          a += src[i + 3]! * wk;
        }
        const o = (row + x) * 4;
        dst[o] = r;
        dst[o + 1] = g;
        dst[o + 2] = b;
        dst[o + 3] = a;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -half; k <= half; k++) {
          const sy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          const wk = kernel[k + half]!;
          const i = (sy * w + x) * 4;
          r += src[i]! * wk;
          g += src[i + 1]! * wk;
          b += src[i + 2]! * wk;
          a += src[i + 3]! * wk;
        }
        const o = (y * w + x) * 4;
        dst[o] = r;
        dst[o + 1] = g;
        dst[o + 2] = b;
        dst[o + 3] = a;
      }
    }
  }
}

/**
 * Box blur of radius `r` (window `2r+1`) along one axis using a running sum: O(n)
 * regardless of radius. Edge clamped.
 */
export function boxBlur1d(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, axis: "x" | "y"): void {
  const n = axis === "x" ? w : h;
  const lines = axis === "x" ? h : w;
  const stride = axis === "x" ? 4 : w * 4;
  const lineStride = axis === "x" ? w * 4 : 4;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    for (let c = 0; c < 4; c++) {
      // Prime the window: sum of clamped samples -r..r around index 0.
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const idx = k < 0 ? 0 : k >= n ? n - 1 : k;
        sum += src[base + idx * stride + c]!;
      }
      for (let i = 0; i < n; i++) {
        dst[base + i * stride + c] = sum * inv;
        const outIdx = i - r < 0 ? 0 : i - r;
        const inIdx = i + r + 1 >= n ? n - 1 : i + r + 1;
        sum += src[base + inIdx * stride + c]! - src[base + outIdx * stride + c]!;
      }
    }
  }
}

/**
 * Three box-blur radii whose triple convolution approximates a Gaussian of `sigma`
 * (Kovesi / Gwosdek et al.).
 */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}

/**
 * Gaussian blur of a premultiplied float image, in place semantics: returns a new array.
 * Exact separable kernel up to `sigma <= 20`, three box passes above.
 */
export function gaussianBlurPremul(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  let a = src;
  let b = new Float32Array(src.length);
  if (sigma <= 20) {
    const k = gaussianKernel(sigma);
    convolve1d(a, b, w, h, k, "x");
    const c = new Float32Array(src.length);
    convolve1d(b, c, w, h, k, "y");
    return c;
  }
  const boxes = boxesForGauss(sigma);
  let cur = a.slice();
  for (const r of boxes) {
    boxBlur1d(cur, b, w, h, r, "x");
    boxBlur1d(b, cur, w, h, r, "y");
  }
  a = cur;
  b = new Float32Array(0);
  return a;
}

/** Gaussian blur of a raster (premultiplied, edge clamped). */
export function gaussianBlurRaster(src: Raster, sigma: number): Raster {
  if (sigma <= 0) return src.clone();
  const f = gaussianBlurPremul(toPremul(src), src.width, src.height, sigma);
  return fromPremul(f, src.width, src.height);
}

/** 3x3 box average of a premultiplied float image (edge clamped). */
export function box3Premul(src: Float32Array, w: number, h: number): Float32Array {
  const k = new Float32Array([1 / 3, 1 / 3, 1 / 3]);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  convolve1d(src, tmp, w, h, k, "x");
  convolve1d(tmp, out, w, h, k, "y");
  return out;
}
