/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher) and the soft
 * morphology built on it (dilate / erode of an 8-bit coverage mask). Shared by
 * `Selection.expand/contract`, layer styles (spread / choke / stroke) and inner glow.
 */

const INF = 1e20;

/**
 * 1-D squared Euclidean distance transform. `f` is the input (0 at features, INF
 * elsewhere), result written to `d`; `v`, `z` are scratch of length `n` / `n + 1`.
 */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dx = q - v[k]!;
    d[q] = dx * dx + f[v[k]!]!;
  }
}

/**
 * Squared distance from every pixel to the nearest pixel where `feature[i] !== 0`
 * (`INF`-ish large values when there is no feature at all).
 */
export function distanceTransformSquared(feature: Uint8Array, w: number, h: number): Float32Array {
  const grid = new Float32Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = feature[i] ? 0 : INF;
  if (w === 0 || h === 0) return grid;
  const n = Math.max(w, h);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x]!;
  }
  return grid;
}

/** Threshold a 0..1 float coverage into a 0/1 feature mask. */
export function thresholdFeature(cov: Float32Array, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) out[i] = cov[i]! >= threshold ? 1 : 0;
  return out;
}

/**
 * Distance (px) from every pixel to the nearest pixel with coverage >= 0.5. Zero inside
 * the shape.
 */
export function distanceOutside(cov: Float32Array, w: number, h: number): Float32Array {
  const d2 = distanceTransformSquared(thresholdFeature(cov), w, h);
  for (let i = 0; i < d2.length; i++) d2[i] = Math.sqrt(d2[i]!);
  return d2;
}

/**
 * Distance (px) from every pixel to the nearest pixel with coverage < 0.5 (the outside).
 * Zero outside the shape; grows towards the shape's medial axis.
 */
export function distanceInside(cov: Float32Array, w: number, h: number): Float32Array {
  const feature = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) feature[i] = cov[i]! < 0.5 ? 1 : 0;
  // Pixels at the canvas border count as adjacent to "outside" (matches PS, where the
  // layer's bounds end the shape).
  const d2 = distanceTransformSquared(feature, w, h);
  for (let i = 0; i < d2.length; i++) d2[i] = Math.sqrt(d2[i]!);
  return d2;
}

/**
 * Soft dilation of a 0..1 coverage by `r` px: every pixel whose centre is within `r`
 * px of the shape (pixel-centre distance, so an integer `r` adds exactly `r` full
 * pixels) becomes covered, with a 1 px anti-aliased ramp for fractional `r`.
 * `r <= 0` returns a copy.
 */
export function dilateCoverage(cov: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(cov.length);
  if (r <= 0) {
    out.set(cov);
    return out;
  }
  const dist = distanceOutside(cov, w, h);
  for (let i = 0; i < cov.length; i++) {
    const soft = Math.max(0, Math.min(1, r + 1 - dist[i]!));
    out[i] = Math.max(cov[i]!, soft);
  }
  return out;
}

/** Soft erosion of a 0..1 coverage by `r` px (inverse of {@link dilateCoverage}). */
export function erodeCoverage(cov: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(cov.length);
  if (r <= 0) {
    out.set(cov);
    return out;
  }
  const dist = distanceInside(cov, w, h);
  for (let i = 0; i < cov.length; i++) {
    const keep = Math.max(0, Math.min(1, dist[i]! - r));
    out[i] = Math.min(cov[i]!, keep);
  }
  return out;
}

/**
 * Separable Gaussian blur of a single-channel float buffer (edge clamped), sigma in
 * px. `sigma <= 0` returns a copy. Exact kernel up to 3 sigma.
 */
export function blurCoverage(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(src.length);
  if (sigma <= 0 || w === 0 || h === 0) {
    out.set(src);
    return out;
  }
  const half = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + half] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let j = -half; j <= half; j++) {
        const sx = x + j < 0 ? 0 : x + j >= w ? w - 1 : x + j;
        acc += src[row + sx]! * k[j + half]!;
      }
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let j = -half; j <= half; j++) {
        const sy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
        acc += tmp[sy * w + x]! * k[j + half]!;
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}
