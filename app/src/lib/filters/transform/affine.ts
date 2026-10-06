/**
 * 2-D affine matrices and bilinear resampling.
 *
 * `Mat` is `[a, b, c, d, e, f]` in CSS `matrix()` order: `x' = a*x + c*y + e`,
 * `y' = b*x + d*y + f`. Pixel `(i, j)` of a raster has its centre at `(i + 0.5, j + 0.5)`.
 */

import { Raster, Rect, type Point } from "$lib/engine";

export type Mat = [number, number, number, number, number, number];

export const Mat = {
  identity(): Mat {
    return [1, 0, 0, 1, 0, 0];
  },
  translate(x: number, y: number): Mat {
    return [1, 0, 0, 1, x, y];
  },
  scale(sx: number, sy: number): Mat {
    return [sx, 0, 0, sy, 0, 0];
  },
  /** Rotation by `rad`, clockwise on screen (y down). */
  rotate(rad: number): Mat {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return [c, s, -s, c, 0, 0];
  },
  /** `A * B`: apply `B` first, then `A`. */
  mul(A: Mat, B: Mat): Mat {
    return [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5],
    ];
  },
  /** Compose left to right: `chain(A, B, C)` applies A first. */
  chain(...ms: Mat[]): Mat {
    let m = Mat.identity();
    for (const x of ms) m = Mat.mul(x, m);
    return m;
  },
  invert(m: Mat): Mat {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) throw new RangeError("Mat.invert: singular matrix");
    const id = 1 / det;
    const a = m[3] * id;
    const b = -m[1] * id;
    const c = -m[2] * id;
    const d = m[0] * id;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  },
  apply(m: Mat, p: Point, out?: Point): Point {
    const o = out ?? { x: 0, y: 0 };
    const x = m[0] * p.x + m[2] * p.y + m[4];
    const y = m[1] * p.x + m[3] * p.y + m[5];
    o.x = x;
    o.y = y;
    return o;
  },
  isIdentity(m: Mat, eps = 1e-9): boolean {
    return (
      Math.abs(m[0] - 1) < eps &&
      Math.abs(m[1]) < eps &&
      Math.abs(m[2]) < eps &&
      Math.abs(m[3] - 1) < eps &&
      Math.abs(m[4]) < eps &&
      Math.abs(m[5]) < eps
    );
  },
  toCss(m: Mat): string {
    return `matrix(${m.map((v) => +v.toFixed(6)).join(", ")})`;
  },
};

/** Integer rect covering the image of `w x h` under `m` (snapped to avoid float dust). */
export function transformedBounds(w: number, h: number, m: Mat): Rect {
  const pts = [
    Mat.apply(m, { x: 0, y: 0 }),
    Mat.apply(m, { x: w, y: 0 }),
    Mat.apply(m, { x: 0, y: h }),
    Mat.apply(m, { x: w, y: h }),
  ];
  const snap = (v: number): number => Math.round(v * 1e6) / 1e6;
  const bb = Rect.boundingPoints(pts.map((p) => ({ x: snap(p.x), y: snap(p.y) })));
  return Rect.roundOut(bb);
}

export type AffineMethod = "nearest" | "bilinear";

/**
 * Resample `src` through `m` (source pixel space -> target space) into a raster covering
 * `outRect` of the target space. Outside the source the image is transparent; sampling
 * is bilinear in premultiplied RGB so edges stay clean.
 */
export function affineResample(src: Raster, m: Mat, outRect: Rect, method: AffineMethod = "bilinear"): Raster {
  const out = new Raster(Math.max(0, outRect.w), Math.max(0, outRect.h));
  if (out.width === 0 || out.height === 0 || src.width === 0 || src.height === 0) return out;
  const inv = Mat.invert(m);
  resampleInto(src.data, src.width, src.height, out.data, out.width, out.height, inv, outRect.x, outRect.y, method);
  return out;
}

/** Typed-array core (shared with the worker). `inv` maps target -> source coordinates. */
export function resampleInto(
  s: Uint8ClampedArray,
  sw: number,
  sh: number,
  d: Uint8ClampedArray,
  ow: number,
  oh: number,
  inv: Mat,
  ox: number,
  oy: number,
  method: AffineMethod,
): void {
  const [a, b, c, dd, e, f] = inv;
  let di = 0;
  for (let y = 0; y < oh; y++) {
    const ty = oy + y + 0.5;
    for (let x = 0; x < ow; x++, di += 4) {
      const tx = ox + x + 0.5;
      // Source continuous coordinates of this pixel centre, then into sample space.
      const u = a * tx + c * ty + e - 0.5;
      const v = b * tx + dd * ty + f - 0.5;
      if (method === "nearest") {
        const sx = Math.round(u);
        const sy = Math.round(v);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const si = (sy * sw + sx) * 4;
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = s[si + 3]!;
        continue;
      }
      if (u <= -1 || v <= -1 || u >= sw || v >= sh) continue;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const tx1 = u - x0;
      const ty1 = v - y0;
      let r = 0;
      let g = 0;
      let bl = 0;
      let al = 0;
      // 4 taps, skipping those outside the source (transparent).
      for (let j = 0; j < 2; j++) {
        const sy = y0 + j;
        if (sy < 0 || sy >= sh) continue;
        const wy = j === 0 ? 1 - ty1 : ty1;
        if (wy === 0) continue;
        for (let i = 0; i < 2; i++) {
          const sx = x0 + i;
          if (sx < 0 || sx >= sw) continue;
          const wgt = wy * (i === 0 ? 1 - tx1 : tx1);
          if (wgt === 0) continue;
          const si = (sy * sw + sx) * 4;
          const sa = s[si + 3]! * wgt;
          r += s[si]! * sa;
          g += s[si + 1]! * sa;
          bl += s[si + 2]! * sa;
          al += sa;
        }
      }
      if (al <= 0) continue;
      d[di] = r / al;
      d[di + 1] = g / al;
      d[di + 2] = bl / al;
      d[di + 3] = al;
    }
  }
}

/** Pixel count above which `affineResampleAsync` offloads to a worker. */
export const WORKER_THRESHOLD_PX = 8_000_000;

/**
 * Like `affineResample` but runs in a Web Worker for big rasters (> 8 MP output) when
 * workers are available; otherwise computes synchronously.
 */
export async function affineResampleAsync(src: Raster, m: Mat, outRect: Rect, method: AffineMethod = "bilinear"): Promise<Raster> {
  const px = Math.max(0, outRect.w) * Math.max(0, outRect.h);
  if (px <= WORKER_THRESHOLD_PX || typeof Worker !== "function") return affineResample(src, m, outRect, method);
  try {
    const worker = new Worker(new URL("./affine.worker.ts", import.meta.url), { type: "module" });
    const data = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<{ data: Uint8ClampedArray<ArrayBuffer> }>) => resolve(ev.data.data);
      worker.onerror = (ev) => reject(new Error(ev.message));
      const copy = new Uint8ClampedArray(src.data);
      worker.postMessage({ data: copy, sw: src.width, sh: src.height, m, rect: outRect, method }, [copy.buffer]);
    });
    worker.terminate();
    return new Raster(outRect.w, outRect.h, data);
  } catch (e) {
    console.warn("[pixelforge] affine worker failed, resampling on the main thread:", e);
    return affineResample(src, m, outRect, method);
  }
}
