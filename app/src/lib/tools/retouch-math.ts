/**
 * Pure pixel math for the retouch tools: dodge / burn / sponge (tonal range weights),
 * color replacement, background erasing, local blur / unsharp. All functions work on
 * a raster region and return a new raster of that region (the brush engine lerps it in
 * by coverage).
 */
import { Raster, Rect, type RGBA } from "$lib/engine";

export type ToneRange = "shadows" | "midtones" | "highlights";

/** Luminance 0..1. */
export function lum(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** PS tonal-range weight for a luminance 0..1. */
export function rangeWeight(range: ToneRange, l: number): number {
  switch (range) {
    case "shadows":
      return Math.max(0, 1 - l * 1.6) ** 1.5;
    case "highlights":
      return Math.max(0, (l - 0.375) * 1.6) ** 1.5;
    default:
      return Math.max(0, 1 - Math.abs(2 * l - 1) ** 1.2);
  }
}

/** Dodge (lighten) or burn (darken) one color by `exposure` 0..1 in a tonal range. */
export function dodgeBurn(c: RGBA, mode: "dodge" | "burn", range: ToneRange, exposure: number, protectTones: boolean, out: RGBA = { r: 0, g: 0, b: 0, a: 0 }): RGBA {
  const l = lum(c.r, c.g, c.b);
  const w = rangeWeight(range, l) * exposure;
  if (w <= 0) {
    out.r = c.r;
    out.g = c.g;
    out.b = c.b;
    out.a = c.a;
    return out;
  }
  if (protectTones) {
    // Scale luminance only, keep the chroma ratios (no hue shift / clipping to white).
    const target = mode === "dodge" ? l + (1 - l) * w : l * (1 - w);
    const k = l > 1e-4 ? target / l : 0;
    if (l <= 1e-4 && mode === "dodge") {
      const v = target * 255;
      out.r = out.g = out.b = v;
    } else {
      out.r = Math.min(255, c.r * k);
      out.g = Math.min(255, c.g * k);
      out.b = Math.min(255, c.b * k);
    }
  } else if (mode === "dodge") {
    out.r = c.r + (255 - c.r) * w;
    out.g = c.g + (255 - c.g) * w;
    out.b = c.b + (255 - c.b) * w;
  } else {
    out.r = c.r * (1 - w);
    out.g = c.g * (1 - w);
    out.b = c.b * (1 - w);
  }
  out.a = c.a;
  return out;
}

/** Sponge: saturate / desaturate by `amount` 0..1 (vibrance protects already-saturated colors). */
export function sponge(c: RGBA, mode: "saturate" | "desaturate", amount: number, vibrance: boolean, out: RGBA = { r: 0, g: 0, b: 0, a: 0 }): RGBA {
  const g = lum(c.r, c.g, c.b) * 255;
  let k: number;
  if (mode === "desaturate") k = 1 - amount;
  else {
    const mx = Math.max(c.r, c.g, c.b);
    const mn = Math.min(c.r, c.g, c.b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    k = 1 + amount * (vibrance ? 1 - sat : 1);
  }
  out.r = Math.max(0, Math.min(255, g + (c.r - g) * k));
  out.g = Math.max(0, Math.min(255, g + (c.g - g) * k));
  out.b = Math.max(0, Math.min(255, g + (c.b - g) * k));
  out.a = c.a;
  return out;
}

/** Max per-channel RGB distance 0..255. */
export function colorDistance(a: RGBA, r: number, g: number, b: number): number {
  return Math.max(Math.abs(a.r - r), Math.abs(a.g - g), Math.abs(a.b - b));
}

// --- HSL helpers (0..1) ------------------------------------------------------------

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export type ReplaceMode = "hue" | "saturation" | "color" | "luminosity";

/**
 * Color Replacement: pixels within `tolerance` (0..100 → 0..255 max-channel distance)
 * of `sampled` take the foreground's hue / saturation / color (keeping luminosity) or
 * luminosity. Returns the replacement color with a soft weight in `out.a` (0..255).
 */
export function replaceColor(c: RGBA, sampled: RGBA, fg: RGBA, mode: ReplaceMode, tolerance: number, antialias: boolean, out: RGBA = { r: 0, g: 0, b: 0, a: 0 }): RGBA {
  const tol = (tolerance / 100) * 255;
  const d = colorDistance(sampled, c.r, c.g, c.b);
  let w = tol <= 0 ? (d === 0 ? 1 : 0) : d <= tol ? 1 : 0;
  if (antialias && tol > 0 && d > tol && d < tol * 1.5) w = 1 - (d - tol) / (tol * 0.5);
  if (w <= 0) {
    out.r = c.r;
    out.g = c.g;
    out.b = c.b;
    out.a = 0;
    return out;
  }
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const [fh, fs, fl] = rgbToHsl(fg.r, fg.g, fg.b);
  let rgb: [number, number, number];
  switch (mode) {
    case "hue":
      rgb = hslToRgb(fh, s, l);
      break;
    case "saturation":
      rgb = hslToRgb(h, fs, l);
      break;
    case "luminosity":
      rgb = hslToRgb(h, s, fl);
      break;
    default:
      rgb = hslToRgb(fh, fs, l);
  }
  out.r = c.r + (rgb[0] - c.r) * w;
  out.g = c.g + (rgb[1] - c.g) * w;
  out.b = c.b + (rgb[2] - c.b) * w;
  out.a = Math.round(w * 255);
  return out;
}

/**
 * Background Eraser weight: how much of a pixel to erase (0..1) given the sampled
 * background color, `tolerance` (0..100) and an optional protected foreground color.
 */
export function backgroundEraseWeight(r: number, g: number, b: number, sampled: RGBA, tolerance: number, protectFg: RGBA | null): number {
  const tol = (tolerance / 100) * 255;
  if (protectFg && colorDistance(protectFg, r, g, b) <= tol * 0.5) return 0;
  const d = colorDistance(sampled, r, g, b);
  if (tol <= 0) return d === 0 ? 1 : 0;
  if (d <= tol * 0.6) return 1;
  if (d >= tol) return 0;
  return 1 - (d - tol * 0.6) / (tol * 0.4);
}

/** Separable box blur of a region, `radius` px (alpha-weighted so transparent edges don't darken). */
export function boxBlurRegion(src: Raster, rect: Rect, radius: number): Raster {
  const r = Math.max(1, Math.round(radius));
  const w = rect.w;
  const h = rect.h;
  const out = new Raster(w, h);
  const tmp = new Float32Array(w * h * 4);
  const sd = src.data;
  const sw = src.width;
  const sh = src.height;
  // Horizontal pass (premultiplied).
  for (let y = 0; y < h; y++) {
    const sy = rect.y + y;
    for (let x = 0; x < w; x++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(sw - 1, Math.max(0, rect.x + x + k));
        if (sy < 0 || sy >= sh) continue;
        const p = (sy * sw + sx) * 4;
        const a = sd[p + 3]! / 255;
        ar += sd[p]! * a;
        ag += sd[p + 1]! * a;
        ab += sd[p + 2]! * a;
        aa += a;
        n++;
      }
      const q = (y * w + x) * 4;
      tmp[q] = ar / Math.max(1, n);
      tmp[q + 1] = ag / Math.max(1, n);
      tmp[q + 2] = ab / Math.max(1, n);
      tmp[q + 3] = aa / Math.max(1, n);
    }
  }
  const od = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const q = (yy * w + x) * 4;
        ar += tmp[q]!;
        ag += tmp[q + 1]!;
        ab += tmp[q + 2]!;
        aa += tmp[q + 3]!;
        n++;
      }
      const o = (y * w + x) * 4;
      const a = aa / n;
      od[o] = a > 0 ? ar / n / a : 0;
      od[o + 1] = a > 0 ? ag / n / a : 0;
      od[o + 2] = a > 0 ? ab / n / a : 0;
      od[o + 3] = a * 255;
    }
  }
  return out;
}

/** Unsharp mask of a region: `src + (src - blur) * amount`. */
export function sharpenRegion(src: Raster, rect: Rect, radius: number, amount: number): Raster {
  const blur = boxBlurRegion(src, rect, radius);
  const out = src.crop(rect);
  const d = out.data;
  const b = blur.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, d[i]! + (d[i]! - b[i]!) * amount));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + (d[i + 1]! - b[i + 1]!) * amount));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + (d[i + 2]! - b[i + 2]!) * amount));
  }
  return out;
}

/** Apply a per-pixel color function over a region of `src`. */
export function mapRegion(src: Raster, rect: Rect, fn: (c: RGBA, out: RGBA) => RGBA): Raster {
  const out = src.crop(rect);
  const d = out.data;
  const c: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  const o: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  for (let i = 0; i < d.length; i += 4) {
    c.r = d[i]!;
    c.g = d[i + 1]!;
    c.b = d[i + 2]!;
    c.a = d[i + 3]!;
    const res = fn(c, o);
    d[i] = res.r;
    d[i + 1] = res.g;
    d[i + 2] = res.b;
    d[i + 3] = res.a;
  }
  return out;
}

/** Red-eye: red-dominant pixels become neutral and darker. Returns true when a pixel qualifies. */
export function isRedEyePixel(r: number, g: number, b: number): boolean {
  return r > 60 && r > g * 1.6 && r > b * 1.6;
}

export function fixRedEye(c: RGBA, darken: number, out: RGBA = { r: 0, g: 0, b: 0, a: 0 }): RGBA {
  const neutral = Math.min(c.r, (c.g + c.b) / 2);
  const k = 1 - darken * 0.8;
  out.r = neutral * k;
  out.g = c.g * k;
  out.b = c.b * k;
  out.a = c.a;
  return out;
}
