/**
 * `Selection`: a soft 8-bit coverage mask the size of the document (0 = unselected,
 * 255 = fully selected) with a cached bounding box.
 *
 * Instances are treated as **immutable by convention**: every operation returns a new
 * `Selection`, which lets stores and the compositor detect changes by identity. If you
 * must write to `mask` directly, call `invalidate()` afterwards.
 */

import { Rect, type Point } from "./rect";
import { Raster } from "./raster";
import type { IRaster, Size } from "./types";

const INF = 1e20;

/**
 * Felzenszwalb & Huttenlocher 1-D squared Euclidean distance transform.
 * `f` is the input (0 at features, INF elsewhere), result written to `d`.
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

/** Squared distance from every pixel to the nearest pixel where `feature[i] !== 0`. */
function distanceTransformSquared(feature: Uint8Array, w: number, h: number): Float32Array {
  const grid = new Float32Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = feature[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  // Columns.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }
  // Rows.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x]!;
  }
  return grid;
}

export class Selection {
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage values 0..255. */
  readonly mask: Uint8Array;
  private bboxCache: Rect | null | undefined = undefined;

  constructor(width: number, height: number, mask?: Uint8Array) {
    if (mask && mask.length !== width * height) {
      throw new RangeError(`Selection: mask length ${mask.length} != ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.mask = mask ?? new Uint8Array(width * height);
  }

  // ------------------------------------------------------------------ factories

  /** Nothing selected. */
  static none(width: number, height: number): Selection {
    return new Selection(width, height);
  }

  /** Everything selected. */
  static all(width: number, height: number): Selection {
    const s = new Selection(width, height);
    s.mask.fill(255);
    s.bboxCache = Rect.ofSize(width, height);
    return s;
  }

  /** Wrap an existing mask (not copied). */
  static fromMask(width: number, height: number, mask: Uint8Array): Selection {
    return new Selection(width, height, mask);
  }

  /** Hard-edged rectangle (fractional rects are rounded out to whole pixels). */
  static fromRect(width: number, height: number, rect: Rect): Selection {
    const s = new Selection(width, height);
    const r = Rect.intersect(Rect.roundOut(rect), Rect.ofSize(width, height));
    if (Rect.isEmpty(r)) return s;
    for (let y = r.y; y < r.y + r.h; y++) s.mask.fill(255, y * width + r.x, y * width + r.x + r.w);
    s.bboxCache = r;
    return s;
  }

  /** Ellipse inscribed in `rect`, optionally anti-aliased (4x4 supersampling at the edge). */
  static fromEllipse(width: number, height: number, rect: Rect, antialias = true): Selection {
    const s = new Selection(width, height);
    if (rect.w <= 0 || rect.h <= 0) return s;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const rx = rect.w / 2;
    const ry = rect.h / 2;
    const area = Rect.intersect(Rect.roundOut(rect), Rect.ofSize(width, height));
    if (Rect.isEmpty(area)) return s;
    const m = s.mask;
    const SS = antialias ? 4 : 1;
    const inside = (px: number, py: number): boolean => {
      const u = (px - cx) / rx;
      const v = (py - cy) / ry;
      return u * u + v * v <= 1;
    };
    for (let y = area.y; y < area.y + area.h; y++) {
      // Nearest row point to the centre decides the widest possible span.
      const dmin = cy >= y && cy <= y + 1 ? 0 : Math.min(Math.abs(y - cy), Math.abs(y + 1 - cy));
      const t = 1 - (dmin / ry) * (dmin / ry);
      if (t <= 0) continue;
      const xrMax = rx * Math.sqrt(t);
      const x0 = Math.max(area.x, Math.floor(cx - xrMax));
      const x1 = Math.min(area.x + area.w - 1, Math.ceil(cx + xrMax));
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        if (inside(x, y) && inside(x + 1, y) && inside(x, y + 1) && inside(x + 1, y + 1)) {
          m[row + x] = 255;
          continue;
        }
        if (SS === 1) {
          m[row + x] = inside(x + 0.5, y + 0.5) ? 255 : 0;
          continue;
        }
        let hits = 0;
        for (let j = 0; j < SS; j++) {
          const py = y + (j + 0.5) / SS;
          for (let i = 0; i < SS; i++) if (inside(x + (i + 0.5) / SS, py)) hits++;
        }
        m[row + x] = Math.round((hits * 255) / (SS * SS));
      }
    }
    s.bboxCache = undefined;
    return s;
  }

  /**
   * Scanline-filled polygon (even-odd rule). With `antialias` the coverage is computed
   * from 4 sub-scanlines per row and fractional horizontal span ends.
   */
  static fromPolygon(width: number, height: number, points: readonly Point[], antialias = true): Selection {
    const s = new Selection(width, height);
    const n = points.length;
    if (n < 3) return s;
    const bb = Rect.intersect(Rect.roundOut(Rect.boundingPoints(points)), Rect.ofSize(width, height));
    if (Rect.isEmpty(bb)) return s;
    const SS = antialias ? 4 : 1;
    const acc = new Float32Array(width);
    const xs: number[] = [];
    const m = s.mask;
    for (let y = bb.y; y < bb.y + bb.h; y++) {
      acc.fill(0, bb.x, bb.x + bb.w);
      for (let k = 0; k < SS; k++) {
        const sy = y + (k + 0.5) / SS;
        xs.length = 0;
        for (let i = 0; i < n; i++) {
          const a = points[i]!;
          const b = points[(i + 1) % n]!;
          if (a.y === b.y) continue;
          const yTop = Math.min(a.y, b.y);
          const yBot = Math.max(a.y, b.y);
          if (sy < yTop || sy >= yBot) continue;
          xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const xa = Math.max(bb.x, xs[i]!);
          const xb = Math.min(bb.x + bb.w, xs[i + 1]!);
          if (xb <= xa) continue;
          if (!antialias) {
            // Centre sampling: pixel is in if xa <= x + 0.5 < xb.
            const px0 = Math.ceil(xa - 0.5);
            const px1 = Math.ceil(xb - 0.5);
            for (let x = px0; x < px1; x++) acc[x] = 1;
            continue;
          }
          const ia = Math.floor(xa);
          const ib = Math.floor(xb);
          if (ia === ib) {
            acc[ia] = acc[ia]! + (xb - xa) / SS;
          } else {
            acc[ia] = acc[ia]! + (ia + 1 - xa) / SS;
            for (let x = ia + 1; x < ib; x++) acc[x] = acc[x]! + 1 / SS;
            if (ib < bb.x + bb.w) acc[ib] = acc[ib]! + (xb - ib) / SS;
          }
        }
      }
      const row = y * width;
      for (let x = bb.x; x < bb.x + bb.w; x++) {
        const c = acc[x]!;
        if (c > 0) m[row + x] = Math.min(255, Math.round(c * 255));
      }
    }
    s.bboxCache = undefined;
    return s;
  }

  /**
   * Magic wand. `tolerance` is 0..255 and compares the maximum per-channel (RGBA)
   * difference against the seed pixel. `contiguous` flood-fills 4-connected pixels;
   * otherwise every matching pixel in the raster is selected.
   *
   * `target` lets a layer that is offset inside a larger document produce a doc-sized
   * selection; defaults to the raster's own size at offset 0,0.
   */
  static fromMagicWand(
    raster: IRaster,
    x: number,
    y: number,
    tolerance: number,
    contiguous = true,
    target?: { size: Size; offset: Point },
  ): Selection {
    const w = raster.width;
    const h = raster.height;
    const size = target?.size ?? { w, h };
    const off = target?.offset ?? { x: 0, y: 0 };
    const s = new Selection(size.w, size.h);
    if (x < 0 || y < 0 || x >= w || y >= h || w === 0 || h === 0) return s;
    const d = raster.data;
    const tol = Math.max(0, Math.min(255, tolerance));
    const si = (y * w + x) * 4;
    const r0 = d[si]!;
    const g0 = d[si + 1]!;
    const b0 = d[si + 2]!;
    const a0 = d[si + 3]!;
    const matches = (i: number): boolean => {
      const p = i * 4;
      return (
        Math.abs(d[p]! - r0) <= tol &&
        Math.abs(d[p + 1]! - g0) <= tol &&
        Math.abs(d[p + 2]! - b0) <= tol &&
        Math.abs(d[p + 3]! - a0) <= tol
      );
    };
    // Work in raster space, then copy into the (possibly larger) selection.
    const local = new Uint8Array(w * h);
    if (!contiguous) {
      for (let i = 0; i < w * h; i++) if (matches(i)) local[i] = 255;
    } else {
      // Scanline flood fill with an explicit stack of pixel indices.
      let stack = new Int32Array(1024);
      let sp = 0;
      const push = (i: number): void => {
        if (sp === stack.length) {
          const bigger = new Int32Array(stack.length * 2);
          bigger.set(stack);
          stack = bigger;
        }
        stack[sp++] = i;
      };
      push(y * w + x);
      while (sp > 0) {
        const i = stack[--sp]!;
        if (local[i] || !matches(i)) continue;
        const py = Math.floor(i / w);
        const rowStart = py * w;
        let xl = i - rowStart;
        let xr = xl;
        while (xl > 0 && !local[rowStart + xl - 1] && matches(rowStart + xl - 1)) xl--;
        while (xr < w - 1 && !local[rowStart + xr + 1] && matches(rowStart + xr + 1)) xr++;
        local.fill(255, rowStart + xl, rowStart + xr + 1);
        for (let px = xl; px <= xr; px++) {
          if (py > 0) {
            const up = rowStart - w + px;
            if (!local[up] && matches(up)) push(up);
          }
          if (py < h - 1) {
            const dn = rowStart + w + px;
            if (!local[dn] && matches(dn)) push(dn);
          }
        }
      }
    }
    s.copyLocal(local, w, h, off);
    return s;
  }

  /** Selection from a layer's alpha channel (soft: alpha is used as coverage). */
  static fromLayerAlpha(raster: IRaster, target?: { size: Size; offset: Point }): Selection {
    const w = raster.width;
    const h = raster.height;
    const size = target?.size ?? { w, h };
    const off = target?.offset ?? { x: 0, y: 0 };
    const s = new Selection(size.w, size.h);
    const local = new Uint8Array(w * h);
    const d = raster.data;
    for (let i = 0, p = 3; i < local.length; i++, p += 4) local[i] = d[p]!;
    s.copyLocal(local, w, h, off);
    return s;
  }

  /** Copy a raster-space mask into this selection at `off`, clipping. */
  private copyLocal(local: Uint8Array, w: number, h: number, off: Point): void {
    const dst = Rect.intersect(Rect.make(off.x, off.y, w, h), Rect.ofSize(this.width, this.height));
    if (Rect.isEmpty(dst)) return;
    for (let y = 0; y < dst.h; y++) {
      const sy = dst.y + y - off.y;
      const sx = dst.x - off.x;
      this.mask.set(local.subarray(sy * w + sx, sy * w + sx + dst.w), (dst.y + y) * this.width + dst.x);
    }
    this.bboxCache = undefined;
  }

  // ------------------------------------------------------------------ queries

  /** Bounding box of non-zero coverage, or `null` when empty. Cached. */
  get bbox(): Rect | null {
    if (this.bboxCache !== undefined) return this.bboxCache;
    const m = this.mask;
    const w = this.width;
    const h = this.height;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (m[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    this.bboxCache = x1 < 0 ? null : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    return this.bboxCache;
  }

  get isEmpty(): boolean {
    return this.bbox === null;
  }

  /** True when every pixel is fully selected. */
  get isAll(): boolean {
    const m = this.mask;
    for (let i = 0; i < m.length; i++) if (m[i] !== 255) return false;
    return m.length > 0;
  }

  /** Coverage 0..255 at a pixel (0 outside the canvas). */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.mask[y * this.width + x]!;
  }

  /** True when the pixel is at least half selected. */
  contains(x: number, y: number): boolean {
    return this.get(x, y) >= 128;
  }

  byteLength(): number {
    return this.mask.byteLength;
  }

  /** Call after writing to `mask` directly. */
  invalidate(): void {
    this.bboxCache = undefined;
  }

  clone(): Selection {
    const s = new Selection(this.width, this.height, new Uint8Array(this.mask));
    s.bboxCache = this.bboxCache;
    return s;
  }

  // ------------------------------------------------------------------ boolean ops

  private assertSameSize(o: Selection): void {
    if (o.width !== this.width || o.height !== this.height) {
      throw new RangeError("Selection: size mismatch");
    }
  }

  /** Union (per-pixel max). */
  add(o: Selection): Selection {
    this.assertSameSize(o);
    const out = this.clone();
    const a = out.mask;
    const b = o.mask;
    for (let i = 0; i < a.length; i++) if (b[i]! > a[i]!) a[i] = b[i]!;
    out.bboxCache = undefined;
    return out;
  }

  /** Remove `o` from this (`a * (1 - b)`). */
  subtract(o: Selection): Selection {
    this.assertSameSize(o);
    const out = this.clone();
    const a = out.mask;
    const b = o.mask;
    for (let i = 0; i < a.length; i++) a[i] = (a[i]! * (255 - b[i]!) + 127) / 255;
    out.bboxCache = undefined;
    return out;
  }

  /** Intersection (per-pixel min). */
  intersect(o: Selection): Selection {
    this.assertSameSize(o);
    const out = this.clone();
    const a = out.mask;
    const b = o.mask;
    for (let i = 0; i < a.length; i++) if (b[i]! < a[i]!) a[i] = b[i]!;
    out.bboxCache = undefined;
    return out;
  }

  invert(): Selection {
    const out = this.clone();
    const a = out.mask;
    for (let i = 0; i < a.length; i++) a[i] = 255 - a[i]!;
    out.bboxCache = undefined;
    return out;
  }

  /** Shift the selection by whole pixels (clipped at the canvas edge). */
  translate(dx: number, dy: number): Selection {
    const out = new Selection(this.width, this.height);
    out.copyLocal(this.mask, this.width, this.height, { x: Math.round(dx), y: Math.round(dy) });
    return out;
  }

  /**
   * Soften the edge with a separable Gaussian blur, `sigma = radius` px (kernel extends
   * to 3 sigma). The canvas edge is clamped, so a full selection stays full.
   */
  feather(radius: number): Selection {
    if (radius <= 0) return this.clone();
    const sigma = radius;
    const half = Math.ceil(sigma * 3);
    const kernel = new Float32Array(half * 2 + 1);
    let sum = 0;
    for (let i = -half; i <= half; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + half] = v;
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / sum;

    const w = this.width;
    const h = this.height;
    const bb = this.bbox;
    if (!bb) return this.clone();
    const area = Rect.intersect(Rect.inflate(bb, half), Rect.ofSize(w, h));
    const src = this.mask;
    const tmp = new Float32Array(w * h);
    // Horizontal pass over the rows that matter.
    for (let y = area.y; y < area.y + area.h; y++) {
      const row = y * w;
      for (let x = area.x; x < area.x + area.w; x++) {
        let acc = 0;
        for (let k = -half; k <= half; k++) {
          const sx = Math.min(w - 1, Math.max(0, x + k));
          acc += src[row + sx]! * kernel[k + half]!;
        }
        tmp[row + x] = acc;
      }
    }
    // Rows outside `area` are zero in src and were not written to tmp (also zero).
    const out = new Selection(w, h);
    const dst = out.mask;
    for (let y = area.y; y < area.y + area.h; y++) {
      for (let x = area.x; x < area.x + area.w; x++) {
        let acc = 0;
        for (let k = -half; k <= half; k++) {
          const sy = Math.min(h - 1, Math.max(0, y + k));
          acc += tmp[sy * w + x]! * kernel[k + half]!;
        }
        dst[y * w + x] = Math.round(acc);
      }
    }
    out.bboxCache = undefined;
    return out;
  }

  /** Grow by `px` with a circular structuring element (hard-edged result, threshold 128). */
  expand(px: number): Selection {
    if (px <= 0) return this.clone();
    const w = this.width;
    const h = this.height;
    const feature = new Uint8Array(w * h);
    for (let i = 0; i < feature.length; i++) feature[i] = this.mask[i]! >= 128 ? 1 : 0;
    const dist = distanceTransformSquared(feature, w, h);
    const out = new Selection(w, h);
    const r2 = px * px;
    for (let i = 0; i < dist.length; i++) out.mask[i] = dist[i]! <= r2 ? 255 : 0;
    return out;
  }

  /** Shrink by `px` with a circular structuring element (hard-edged result, threshold 128). */
  contract(px: number): Selection {
    if (px <= 0) return this.clone();
    const w = this.width;
    const h = this.height;
    const feature = new Uint8Array(w * h);
    for (let i = 0; i < feature.length; i++) feature[i] = this.mask[i]! >= 128 ? 0 : 1;
    const dist = distanceTransformSquared(feature, w, h);
    const out = new Selection(w, h);
    const r2 = px * px;
    for (let i = 0; i < dist.length; i++) out.mask[i] = dist[i]! > r2 ? 255 : 0;
    return out;
  }

  // ------------------------------------------------------------------ exports

  /**
   * RGBA raster in the OpenAI `/images/edits` mask convention: **alpha = 0 where the
   * selection is (the area to regenerate), opaque elsewhere**. Soft edges map to partial
   * alpha. RGB is black. Encode to PNG with `canvas.toBlob` before sending.
   */
  toMaskPng(): Raster {
    const r = new Raster(this.width, this.height);
    const d = r.data;
    const m = this.mask;
    for (let i = 0, p = 3; i < m.length; i++, p += 4) d[p] = 255 - m[i]!;
    return r;
  }

  /** Opaque grayscale raster: white = selected, black = unselected. */
  toLuminanceMask(): Raster {
    const r = new Raster(this.width, this.height);
    const d = r.data;
    const m = this.mask;
    for (let i = 0, p = 0; i < m.length; i++, p += 4) {
      const v = m[i]!;
      d[p] = v;
      d[p + 1] = v;
      d[p + 2] = v;
      d[p + 3] = 255;
    }
    return r;
  }

  /** Resampled copy (nearest for hard masks, bilinear otherwise) for Image Size. */
  resized(w: number, h: number): Selection {
    const lum = this.toLuminanceMask().resize(w, h, "bilinear");
    const out = new Selection(w, h);
    const d = lum.data;
    for (let i = 0, p = 0; i < out.mask.length; i++, p += 4) out.mask[i] = d[p]!;
    return out;
  }
}
