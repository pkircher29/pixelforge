/**
 * `Raster`: the v1 pixel buffer. RGBA8, straight alpha, full-canvas `Uint8ClampedArray`.
 *
 * All methods that return a raster return a **new** instance; `fill`, `setPixel` and
 * `blit` mutate in place. Hot loops use plain index arithmetic on typed arrays (no
 * per-pixel closures) so brush and filter code can build on them.
 */

import { Rect } from "./rect";
import type { BlitOptions, IRaster, ResampleMethod, RGBA } from "./types";

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

/** Construct an RGBA colour literal. */
export function rgba(r: number, g: number, b: number, a = 255): RGBA {
  return { r, g, b, a };
}

/** Catmull-Rom / Keys cubic kernel with a = -0.5. */
function cubicWeight(t: number): number {
  const a = -0.5;
  const x = Math.abs(t);
  if (x < 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
  return 0;
}

export class Raster implements IRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  /**
   * Create a raster. When `data` is given it is used as-is (not copied) and must have
   * exactly `width * height * 4` bytes.
   */
  constructor(width: number, height: number, data?: Uint8ClampedArray<ArrayBuffer>) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
      throw new RangeError(`Raster: invalid size ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    if (data) {
      if (data.length !== width * height * 4) {
        throw new RangeError(
          `Raster: data length ${data.length} != ${width}x${height}x4 (${width * height * 4})`,
        );
      }
      this.data = data;
    } else {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }

  /** Raster filled with one colour. */
  static filled(width: number, height: number, color: RGBA): Raster {
    const r = new Raster(width, height);
    r.fill(color);
    return r;
  }

  /** Wrap canvas `ImageData` (copies the bytes). */
  static fromImageData(img: ImageData): Raster {
    return new Raster(img.width, img.height, new Uint8ClampedArray(img.data));
  }

  /** Wrap raw RGBA bytes (copies). Accepts any `ArrayBufferView` of the right length. */
  static fromBytes(width: number, height: number, bytes: ArrayBufferView): Raster {
    const view = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Raster(width, height, new Uint8ClampedArray(view));
  }

  bounds(): Rect {
    return Rect.ofSize(this.width, this.height);
  }

  byteLength(): number {
    return this.data.byteLength;
  }

  clone(): Raster {
    return new Raster(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  fill(color: RGBA, rect?: Rect): void {
    const d = this.data;
    const area = rect ? Rect.intersect(rect, this.bounds()) : this.bounds();
    if (Rect.isEmpty(area)) return;
    const { r, g, b, a } = color;
    if (!rect || Rect.equals(area, this.bounds())) {
      // Fill one row then replicate with copyWithin: much faster than a 4-byte loop.
      const rowLen = this.width * 4;
      for (let i = 0; i < rowLen; i += 4) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = a;
      }
      for (let y = 1; y < this.height; y++) d.copyWithin(y * rowLen, 0, rowLen);
      return;
    }
    for (let y = area.y; y < area.y + area.h; y++) {
      let i = (y * this.width + area.x) * 4;
      for (let x = 0; x < area.w; x++, i += 4) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = a;
      }
    }
  }

  /** Set every byte to 0 (transparent black) inside `rect` or everywhere. */
  clear(rect?: Rect): void {
    this.fill(TRANSPARENT, rect);
  }

  getPixel(x: number, y: number, out?: RGBA): RGBA {
    const o = out ?? { r: 0, g: 0, b: 0, a: 0 };
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      o.r = o.g = o.b = o.a = 0;
      return o;
    }
    const i = (y * this.width + x) * 4;
    const d = this.data;
    o.r = d[i]!;
    o.g = d[i + 1]!;
    o.b = d[i + 2]!;
    o.a = d[i + 3]!;
    return o;
  }

  setPixel(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    d[i] = c.r;
    d[i + 1] = c.g;
    d[i + 2] = c.b;
    d[i + 3] = c.a;
  }

  /**
   * Draw `src` (or `srcRect` of it) at `dx, dy`. Default mode is straight-alpha "over":
   * `ao = as + ad(1-as)`, `co = (cs*as + cd*ad*(1-as)) / ao`.
   */
  blit(src: IRaster, dx: number, dy: number, srcRect?: Rect, opts?: BlitOptions): void {
    const sr = srcRect ? Rect.intersect(srcRect, src.bounds()) : src.bounds();
    if (Rect.isEmpty(sr)) return;
    // Destination rect, clamped; shift the source rect by the same amount.
    const dstFull = Rect.make(dx, dy, sr.w, sr.h);
    const dst = Rect.intersect(dstFull, this.bounds());
    if (Rect.isEmpty(dst)) return;
    const sx0 = sr.x + (dst.x - dstFull.x);
    const sy0 = sr.y + (dst.y - dstFull.y);
    const mode = opts?.mode ?? "over";
    const opacity = Math.min(1, Math.max(0, opts?.opacity ?? 1));
    const s = src.data;
    const d = this.data;
    const sw = src.width;
    const dw = this.width;

    if (mode === "replace" && opacity >= 1) {
      const rowBytes = dst.w * 4;
      for (let y = 0; y < dst.h; y++) {
        const si = ((sy0 + y) * sw + sx0) * 4;
        const di = ((dst.y + y) * dw + dst.x) * 4;
        d.set(s.subarray(si, si + rowBytes), di);
      }
      return;
    }

    for (let y = 0; y < dst.h; y++) {
      let si = ((sy0 + y) * sw + sx0) * 4;
      let di = ((dst.y + y) * dw + dst.x) * 4;
      for (let x = 0; x < dst.w; x++, si += 4, di += 4) {
        const as = (s[si + 3]! / 255) * opacity;
        if (as <= 0) continue;
        if (mode === "replace") {
          // Replace with opacity: linear interpolate bytes (used by soft clone/erase).
          const t = opacity;
          d[di] = d[di]! + (s[si]! - d[di]!) * t;
          d[di + 1] = d[di + 1]! + (s[si + 1]! - d[di + 1]!) * t;
          d[di + 2] = d[di + 2]! + (s[si + 2]! - d[di + 2]!) * t;
          d[di + 3] = d[di + 3]! + (s[si + 3]! - d[di + 3]!) * t;
          continue;
        }
        const ad = d[di + 3]! / 255;
        if (as >= 1 || ad <= 0) {
          d[di] = s[si]!;
          d[di + 1] = s[si + 1]!;
          d[di + 2] = s[si + 2]!;
          d[di + 3] = as * 255;
          continue;
        }
        const ao = as + ad * (1 - as);
        const wd = (ad * (1 - as)) / ao;
        const ws = as / ao;
        d[di] = s[si]! * ws + d[di]! * wd;
        d[di + 1] = s[si + 1]! * ws + d[di + 1]! * wd;
        d[di + 2] = s[si + 2]! * ws + d[di + 2]! * wd;
        d[di + 3] = ao * 255;
      }
    }
  }

  crop(rect: Rect): Raster {
    const out = new Raster(Math.max(0, rect.w), Math.max(0, rect.h));
    out.blit(this, -rect.x, -rect.y, undefined, { mode: "replace" });
    return out;
  }

  resize(w: number, h: number, method: ResampleMethod = "bilinear"): Raster {
    const out = new Raster(w, h);
    if (w === 0 || h === 0 || this.width === 0 || this.height === 0) return out;
    if (w === this.width && h === this.height) return this.clone();
    switch (method) {
      case "nearest":
        this.resizeNearest(out);
        break;
      case "bilinear":
        this.resizeBilinear(out);
        break;
      case "bicubic":
        this.resizeBicubic(out);
        break;
    }
    return out;
  }

  private resizeNearest(out: Raster): void {
    const s = this.data;
    const d = out.data;
    const sw = this.width;
    const sh = this.height;
    const xs = new Int32Array(out.width);
    for (let x = 0; x < out.width; x++) xs[x] = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / out.width));
    let di = 0;
    for (let y = 0; y < out.height; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / out.height));
      const row = sy * sw;
      for (let x = 0; x < out.width; x++, di += 4) {
        const si = (row + xs[x]!) * 4;
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = s[si + 3]!;
      }
    }
  }

  /** Premultiplied float copy (avoids dark fringes when filtering across alpha edges). */
  private toPremultipliedFloat(): Float32Array {
    const s = this.data;
    const n = s.length;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i += 4) {
      const a = s[i + 3]! / 255;
      f[i] = s[i]! * a;
      f[i + 1] = s[i + 1]! * a;
      f[i + 2] = s[i + 2]! * a;
      f[i + 3] = s[i + 3]!;
    }
    return f;
  }

  private resizeBilinear(out: Raster): void {
    const f = this.toPremultipliedFloat();
    const d = out.data;
    const sw = this.width;
    const sh = this.height;
    const scaleX = sw / out.width;
    const scaleY = sh / out.height;
    let di = 0;
    for (let y = 0; y < out.height; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < out.width; x++, di += 4) {
        const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const tx = fx - x0;
        const i00 = (y0 * sw + x0) * 4;
        const i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4;
        const i11 = (y1 * sw + x1) * 4;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const a = f[i00 + 3]! * w00 + f[i10 + 3]! * w10 + f[i01 + 3]! * w01 + f[i11 + 3]! * w11;
        if (a <= 0) {
          d[di] = d[di + 1] = d[di + 2] = d[di + 3] = 0;
          continue;
        }
        const inv = 255 / a;
        d[di] = (f[i00]! * w00 + f[i10]! * w10 + f[i01]! * w01 + f[i11]! * w11) * inv;
        d[di + 1] = (f[i00 + 1]! * w00 + f[i10 + 1]! * w10 + f[i01 + 1]! * w01 + f[i11 + 1]! * w11) * inv;
        d[di + 2] = (f[i00 + 2]! * w00 + f[i10 + 2]! * w10 + f[i01 + 2]! * w01 + f[i11 + 2]! * w11) * inv;
        d[di + 3] = a;
      }
    }
  }

  private resizeBicubic(out: Raster): void {
    const f = this.toPremultipliedFloat();
    const d = out.data;
    const sw = this.width;
    const sh = this.height;
    const scaleX = sw / out.width;
    const scaleY = sh / out.height;
    const wx = new Float32Array(4);
    const wy = new Float32Array(4);
    let di = 0;
    for (let y = 0; y < out.height; y++) {
      const fy = (y + 0.5) * scaleY - 0.5;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let k = 0; k < 4; k++) wy[k] = cubicWeight(ty - (k - 1));
      for (let x = 0; x < out.width; x++, di += 4) {
        const fx = (x + 0.5) * scaleX - 0.5;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        for (let k = 0; k < 4; k++) wx[k] = cubicWeight(tx - (k - 1));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let j = 0; j < 4; j++) {
          const sy = Math.min(sh - 1, Math.max(0, y0 + j - 1));
          const wyj = wy[j]!;
          if (wyj === 0) continue;
          for (let i = 0; i < 4; i++) {
            const sx = Math.min(sw - 1, Math.max(0, x0 + i - 1));
            const w = wyj * wx[i]!;
            if (w === 0) continue;
            const si = (sy * sw + sx) * 4;
            r += f[si]! * w;
            g += f[si + 1]! * w;
            b += f[si + 2]! * w;
            a += f[si + 3]! * w;
          }
        }
        if (a <= 0) {
          d[di] = d[di + 1] = d[di + 2] = d[di + 3] = 0;
          continue;
        }
        const inv = 255 / a;
        d[di] = r * inv;
        d[di + 1] = g * inv;
        d[di + 2] = b * inv;
        d[di + 3] = a;
      }
    }
  }

  flipH(): Raster {
    const out = new Raster(this.width, this.height);
    const s = this.data;
    const d = out.data;
    const w = this.width;
    for (let y = 0; y < this.height; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const si = (row + x) * 4;
        const di = (row + (w - 1 - x)) * 4;
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = s[si + 3]!;
      }
    }
    return out;
  }

  flipV(): Raster {
    const out = new Raster(this.width, this.height);
    const rowBytes = this.width * 4;
    for (let y = 0; y < this.height; y++) {
      const si = y * rowBytes;
      out.data.set(this.data.subarray(si, si + rowBytes), (this.height - 1 - y) * rowBytes);
    }
    return out;
  }

  rotate90(cw: boolean): Raster {
    const w = this.width;
    const h = this.height;
    const out = new Raster(h, w);
    const s = this.data;
    const d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4;
        // cw: (x, y) -> (h-1-y, x); ccw: (x, y) -> (y, w-1-x)
        const dx = cw ? h - 1 - y : y;
        const dy = cw ? x : w - 1 - x;
        const di = (dy * h + dx) * 4;
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = s[si + 3]!;
      }
    }
    return out;
  }

  boundingBoxOfAlpha(threshold = 0): Rect | null {
    const d = this.data;
    const w = this.width;
    const h = this.height;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      let i = y * w * 4 + 3;
      for (let x = 0; x < w; x++, i += 4) {
        if (d[i]! > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  toImageData(): ImageData {
    if (typeof ImageData === "function") {
      return new ImageData(this.data, this.width, this.height);
    }
    // Test environments (jsdom) lack ImageData; return a structurally identical object.
    const shim: { width: number; height: number; data: Uint8ClampedArray; colorSpace: "srgb" } = {
      width: this.width,
      height: this.height,
      data: this.data,
      colorSpace: "srgb",
    };
    return shim as unknown as ImageData;
  }

  /** True when every pixel is identical. */
  equals(other: IRaster): boolean {
    if (other.width !== this.width || other.height !== this.height) return false;
    const a = this.data;
    const b = other.data;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
}
