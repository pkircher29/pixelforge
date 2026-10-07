/**
 * Colour model (pure): RGB ↔ HSB ↔ hex, CMYK approximation, grayscale, web-safe
 * snapping, and the "cube" geometry shared by the Color panel and the Color Picker
 * (the square + strip of Photoshop's picker in its six H/S/B/R/G/B modes).
 * Tested in `tests/panels/color-model.test.ts`.
 */
import type { RGBA } from "$lib/engine";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Hue 0..360, saturation and brightness 0..100 (Photoshop's HSB). */
export interface HSB {
  h: number;
  s: number;
  b: number;
}

/** 0..100 each (PS "CMYK" readout, no profile: the naive conversion). */
export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbEquals(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

export function toRgba(c: RGB, a = 255): RGBA {
  return { r: clampByte(c.r), g: clampByte(c.g), b: clampByte(c.b), a };
}

// ---------------------------------------------------------------------------- hex

/** `#rrggbb` lower-case. */
export function rgbToHex(c: RGB): string {
  const h = (n: number): string => clampByte(n).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Accepts `#rgb`, `#rrggbb`, with or without `#`, any case, surrounding spaces. */
export function hexToRgb(hex: string): RGB | null {
  const s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    const n = parseInt(s, 16);
    const r = (n >> 8) & 15;
    const g = (n >> 4) & 15;
    const b = n & 15;
    return { r: r * 17, g: g * 17, b: b * 17 };
  }
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---------------------------------------------------------------------------- HSB

export function rgbToHsb(c: RGB): HSB {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: round1(h), s: round1(s * 100), b: round1(max * 100) };
}

export function hsbToRgb(c: HSB): RGB {
  const h = (((c.h % 360) + 360) % 360) / 60;
  const s = Math.max(0, Math.min(100, c.s)) / 100;
  const v = Math.max(0, Math.min(100, c.b)) / 100;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r: number;
  let g: number;
  let b: number;
  switch (i % 6) {
    case 0:
      [r, g, b] = [v, t, p];
      break;
    case 1:
      [r, g, b] = [q, v, p];
      break;
    case 2:
      [r, g, b] = [p, v, t];
      break;
    case 3:
      [r, g, b] = [p, q, v];
      break;
    case 4:
      [r, g, b] = [t, p, v];
      break;
    default:
      [r, g, b] = [v, p, q];
  }
  return { r: clampByte(r * 255), g: clampByte(g * 255), b: clampByte(b * 255) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------- CMYK / gray

/** Naive (profile-less) CMYK, percentages. Pure black → K 100, pure white → all 0. */
export function rgbToCmyk(c: RGB): CMYK {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const d = 1 - k;
  return { c: Math.round(((1 - r - k) / d) * 100), m: Math.round(((1 - g - k) / d) * 100), y: Math.round(((1 - b - k) / d) * 100), k: Math.round(k * 100) };
}

export function cmykToRgb(c: CMYK): RGB {
  const k = c.k / 100;
  const f = (v: number): number => clampByte(255 * (1 - v / 100) * (1 - k));
  return { r: f(c.c), g: f(c.m), b: f(c.y) };
}

/** PS Grayscale slider: K % (0 = white, 100 = black) from Rec. 601 luma. */
export function rgbToGrayK(c: RGB): number {
  const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return Math.round((1 - luma / 255) * 100);
}

export function grayKToRgb(k: number): RGB {
  const v = clampByte(255 * (1 - Math.max(0, Math.min(100, k)) / 100));
  return { r: v, g: v, b: v };
}

/** Luminance 0..255 (for choosing light/dark cursors over a colour). */
export function luma(c: RGB): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

// ---------------------------------------------------------------------------- web safe

/** Nearest of the 216 web-safe colours (each channel snapped to a multiple of 51). */
export function snapWebSafe(c: RGB): RGB {
  const s = (n: number): number => Math.round(clampByte(n) / 51) * 51;
  return { r: s(c.r), g: s(c.g), b: s(c.b) };
}

export function isWebSafe(c: RGB): boolean {
  return [c.r, c.g, c.b].every((n) => n % 51 === 0);
}

// ---------------------------------------------------------------------------- cube geometry

/**
 * Which field drives the vertical strip (Photoshop's radio buttons). The square then
 * shows the two remaining fields of that colour model:
 * - `H`: strip hue (red at top), square x = saturation, y = brightness
 * - `S`: strip saturation, square x = hue, y = brightness
 * - `B`: strip brightness, square x = hue, y = saturation
 * - `R`: strip red, square x = blue, y = green
 * - `G`: strip green, square x = blue, y = red
 * - `BL`: strip blue, square x = red, y = green
 */
export type CubeMode = "H" | "S" | "B" | "R" | "G" | "BL";

export interface CubePos {
  /** Strip value 0..1, 1 = top of the strip. */
  v: number;
  /** Square x 0..1, left → right. */
  u: number;
  /** Square y 0..1, 0 = bottom, 1 = top. */
  w: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Colour at a cube position. */
export function cubeColor(mode: CubeMode, pos: CubePos): RGB {
  const v = clamp01(pos.v);
  const u = clamp01(pos.u);
  const w = clamp01(pos.w);
  switch (mode) {
    case "H":
      return hsbToRgb({ h: (1 - v) * 360, s: u * 100, b: w * 100 });
    case "S":
      return hsbToRgb({ h: u * 360, s: v * 100, b: w * 100 });
    case "B":
      return hsbToRgb({ h: u * 360, s: w * 100, b: v * 100 });
    case "R":
      return { r: clampByte(v * 255), g: clampByte(w * 255), b: clampByte(u * 255) };
    case "G":
      return { r: clampByte(w * 255), g: clampByte(v * 255), b: clampByte(u * 255) };
    case "BL":
      return { r: clampByte(u * 255), g: clampByte(w * 255), b: clampByte(v * 255) };
  }
}

/** Cube position of a colour (`hsb` lets callers keep a hue through s = 0 / b = 0). */
export function cubePosition(mode: CubeMode, c: RGB, hsb: HSB = rgbToHsb(c)): CubePos {
  switch (mode) {
    case "H":
      return { v: 1 - hsb.h / 360, u: hsb.s / 100, w: hsb.b / 100 };
    case "S":
      return { v: hsb.s / 100, u: hsb.h / 360, w: hsb.b / 100 };
    case "B":
      return { v: hsb.b / 100, u: hsb.h / 360, w: hsb.s / 100 };
    case "R":
      return { v: c.r / 255, u: c.b / 255, w: c.g / 255 };
    case "G":
      return { v: c.g / 255, u: c.b / 255, w: c.r / 255 };
    case "BL":
      return { v: c.b / 255, u: c.r / 255, w: c.g / 255 };
  }
}

/** Colour along the strip at `v` for the current square point (the strip previews the current u/w in R/G/B/S/B modes). */
export function stripColor(mode: CubeMode, v: number, pos: CubePos): RGB {
  if (mode === "H") return hsbToRgb({ h: (1 - clamp01(v)) * 360, s: 100, b: 100 });
  return cubeColor(mode, { v, u: pos.u, w: pos.w });
}

/** Paint the square (`w × h` RGBA bytes) for a strip value. */
export function paintCube(mode: CubeMode, v: number, out: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const wy = 1 - y / Math.max(1, h - 1);
    for (let x = 0; x < w; x++) {
      const c = cubeColor(mode, { v, u: x / Math.max(1, w - 1), w: wy });
      const i = (y * w + x) * 4;
      out[i] = c.r;
      out[i + 1] = c.g;
      out[i + 2] = c.b;
      out[i + 3] = 255;
    }
  }
}

/** Paint the vertical strip (`w × h`) for the current square point. */
export function paintStrip(mode: CubeMode, pos: CubePos, out: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const c = stripColor(mode, 1 - y / Math.max(1, h - 1), pos);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = c.r;
      out[i + 1] = c.g;
      out[i + 2] = c.b;
      out[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------- Color panel ramps

/** PS Color panel spectrum ramp (slider modes): hue sweep, white at the left end, black at the right. */
export function rampColor(t: number): RGB {
  const x = clamp01(t);
  if (x < 0.04) return { r: 255, g: 255, b: 255 };
  if (x > 0.96) return { r: 0, g: 0, b: 0 };
  const h = ((x - 0.04) / 0.92) * 360;
  return hsbToRgb({ h, s: 100, b: 100 });
}

/** Gradient stops for a slider track: channel `ch` of `c` swept 0..255 (RGB sliders) as CSS. */
export function rgbSliderGradient(c: RGB, ch: keyof RGB): string {
  const lo = rgbToHex({ ...c, [ch]: 0 });
  const hi = rgbToHex({ ...c, [ch]: 255 });
  return `linear-gradient(to right, ${lo}, ${hi})`;
}

export function hsbSliderGradient(c: HSB, ch: keyof HSB): string {
  if (ch === "h") {
    const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => rgbToHex(hsbToRgb({ h, s: c.s, b: c.b })));
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }
  const lo = rgbToHex(hsbToRgb({ ...c, [ch]: 0 }));
  const hi = rgbToHex(hsbToRgb({ ...c, [ch]: 100 }));
  return `linear-gradient(to right, ${lo}, ${hi})`;
}
