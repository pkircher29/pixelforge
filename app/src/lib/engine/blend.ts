/**
 * Blend-mode formulas, kept in one place so the CPU compositor and the GLSL compositor
 * share them. Separable modes follow the W3C Compositing and Blending Level 1 spec;
 * the non-separable modes (hue / saturation / color / luminosity) use the Photoshop
 * formulas that the same spec adopts (Lum / ClipColor / SetLum / Sat / SetSat).
 *
 * All CPU functions work on 0..1 floats and avoid allocation (module-level scratch).
 * The GLSL strings are *function bodies* taking `vec3 cb` (backdrop) and `vec3 cs`
 * (source) and returning `vec3`; `composite/shaders.ts` assembles them into a program.
 */

import { BlendMode } from "./types";

/** The 16 modes in Photoshop panel order (also the GLSL `u_mode` index order). */
export const BLEND_MODES: readonly BlendMode[] = [
  BlendMode.Normal,
  BlendMode.Multiply,
  BlendMode.Screen,
  BlendMode.Overlay,
  BlendMode.Darken,
  BlendMode.Lighten,
  BlendMode.ColorDodge,
  BlendMode.ColorBurn,
  BlendMode.HardLight,
  BlendMode.SoftLight,
  BlendMode.Difference,
  BlendMode.Exclusion,
  BlendMode.Hue,
  BlendMode.Saturation,
  BlendMode.Color,
  BlendMode.Luminosity,
];

/** Mode -> integer used by the GLSL `switch`. */
export const BLEND_MODE_INDEX: Readonly<Record<BlendMode, number>> = Object.fromEntries(
  BLEND_MODES.map((m, i) => [m, i]),
) as Record<BlendMode, number>;

/** Human-readable labels for menus. */
export const BLEND_MODE_LABEL: Readonly<Record<BlendMode, string>> = {
  [BlendMode.Normal]: "Normal",
  [BlendMode.Multiply]: "Multiply",
  [BlendMode.Screen]: "Screen",
  [BlendMode.Overlay]: "Overlay",
  [BlendMode.Darken]: "Darken",
  [BlendMode.Lighten]: "Lighten",
  [BlendMode.ColorDodge]: "Color Dodge",
  [BlendMode.ColorBurn]: "Color Burn",
  [BlendMode.HardLight]: "Hard Light",
  [BlendMode.SoftLight]: "Soft Light",
  [BlendMode.Difference]: "Difference",
  [BlendMode.Exclusion]: "Exclusion",
  [BlendMode.Hue]: "Hue",
  [BlendMode.Saturation]: "Saturation",
  [BlendMode.Color]: "Color",
  [BlendMode.Luminosity]: "Luminosity",
};

/** True for modes that operate channel by channel. */
export function isSeparable(mode: BlendMode): boolean {
  return BLEND_MODE_INDEX[mode] < BLEND_MODE_INDEX[BlendMode.Hue];
}

/** True when `s` is one of the 16 mode ids. */
export function isBlendMode(s: string): s is BlendMode {
  return (BLEND_MODES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Separable modes (per channel, 0..1)
// ---------------------------------------------------------------------------

function hardLight(cb: number, cs: number): number {
  return cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1);
}

function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

/**
 * Blend one channel. Only valid for separable modes; non-separable modes throw.
 * `cb` = backdrop, `cs` = source, both 0..1.
 */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case BlendMode.Normal:
      return cs;
    case BlendMode.Multiply:
      return cb * cs;
    case BlendMode.Screen:
      return cb + cs - cb * cs;
    case BlendMode.Overlay:
      return hardLight(cs, cb);
    case BlendMode.Darken:
      return Math.min(cb, cs);
    case BlendMode.Lighten:
      return Math.max(cb, cs);
    case BlendMode.ColorDodge:
      if (cb === 0) return 0;
      if (cs >= 1) return 1;
      return Math.min(1, cb / (1 - cs));
    case BlendMode.ColorBurn:
      if (cb >= 1) return 1;
      if (cs <= 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    case BlendMode.HardLight:
      return hardLight(cb, cs);
    case BlendMode.SoftLight:
      return softLight(cb, cs);
    case BlendMode.Difference:
      return Math.abs(cb - cs);
    case BlendMode.Exclusion:
      return cb + cs - 2 * cb * cs;
    default:
      throw new Error(`blendChannel: ${mode} is not separable`);
  }
}

// ---------------------------------------------------------------------------
// Non-separable helpers (Photoshop / W3C)
// ---------------------------------------------------------------------------

function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

/** ClipColor in place on `out[0..2]`. */
function clipColor(out: Float32Array): void {
  const r = out[0]!;
  const g = out[1]!;
  const b = out[2]!;
  const l = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const k = l / (l - n);
    out[0] = l + (r - l) * k;
    out[1] = l + (g - l) * k;
    out[2] = l + (b - l) * k;
  }
  if (x > 1) {
    const r2 = out[0]!;
    const g2 = out[1]!;
    const b2 = out[2]!;
    const k = (1 - l) / (x - l);
    out[0] = l + (r2 - l) * k;
    out[1] = l + (g2 - l) * k;
    out[2] = l + (b2 - l) * k;
  }
}

/** SetLum(c, l) -> out. */
function setLum(r: number, g: number, b: number, l: number, out: Float32Array): void {
  const d = l - lum(r, g, b);
  out[0] = r + d;
  out[1] = g + d;
  out[2] = b + d;
  clipColor(out);
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** SetSat(c, s) -> out. */
function setSat(r: number, g: number, b: number, s: number, out: Float32Array): void {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx > mn) {
    const k = s / (mx - mn);
    out[0] = (r - mn) * k;
    out[1] = (g - mn) * k;
    out[2] = (b - mn) * k;
  } else {
    out[0] = out[1] = out[2] = 0;
  }
}

const tmp3 = new Float32Array(3);

/**
 * Blend an RGB triple (0..1 floats) with any of the 16 modes into `out[0..2]`.
 * No allocation; safe to call per pixel.
 */
export function blendRgb(
  mode: BlendMode,
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
  out: Float32Array,
): void {
  switch (mode) {
    case BlendMode.Hue:
      setSat(sr, sg, sb, sat(br, bg, bb), tmp3);
      setLum(tmp3[0]!, tmp3[1]!, tmp3[2]!, lum(br, bg, bb), out);
      return;
    case BlendMode.Saturation:
      setSat(br, bg, bb, sat(sr, sg, sb), tmp3);
      setLum(tmp3[0]!, tmp3[1]!, tmp3[2]!, lum(br, bg, bb), out);
      return;
    case BlendMode.Color:
      setLum(sr, sg, sb, lum(br, bg, bb), out);
      return;
    case BlendMode.Luminosity:
      setLum(br, bg, bb, lum(sr, sg, sb), out);
      return;
    default:
      out[0] = blendChannel(mode, br, sr);
      out[1] = blendChannel(mode, bg, sg);
      out[2] = blendChannel(mode, bb, sb);
  }
}

const blendTmp = new Float32Array(3);

/**
 * Full straight-alpha compositing step (W3C "general formula"):
 *
 * ```
 * ao = as + ab * (1 - as)
 * Co = (1 - as) * ab * Cb + as * (1 - ab) * Cs + as * ab * B(Cb, Cs)      (premultiplied)
 * co = Co / ao                                                              (straight)
 * ```
 *
 * Inputs and outputs are 0..1 floats; `out` receives straight `[r, g, b, a]`.
 */
export function compositeStraight(
  mode: BlendMode,
  br: number,
  bg: number,
  bb: number,
  ab: number,
  sr: number,
  sg: number,
  sb: number,
  as: number,
  out: Float32Array,
): void {
  const ao = as + ab * (1 - as);
  if (ao <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  blendRgb(mode, br, bg, bb, sr, sg, sb, blendTmp);
  const wb = (1 - as) * ab;
  const ws = as * (1 - ab);
  const wm = as * ab;
  out[0] = (wb * br + ws * sr + wm * blendTmp[0]!) / ao;
  out[1] = (wb * bg + ws * sg + wm * blendTmp[1]!) / ao;
  out[2] = (wb * bb + ws * sb + wm * blendTmp[2]!) / ao;
  out[3] = ao;
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/** Shared GLSL helpers for the non-separable modes. Prefixed `pf_` to avoid clashes. */
export const BLEND_GLSL_HELPERS = `
float pf_lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 pf_clipColor(vec3 c) {
  float l = pf_lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 pf_setLum(vec3 c, float l) { return pf_clipColor(c + (l - pf_lum(c))); }
float pf_sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 pf_setSat(vec3 c, float s) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  if (mx > mn) return (c - mn) * s / (mx - mn);
  return vec3(0.0);
}
vec3 pf_hardLight(vec3 cb, vec3 cs) {
  return mix(2.0 * cb * cs, 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs), step(0.5, cs));
}
`;

/**
 * GLSL function bodies, one per mode: `vec3 blend_<i>(vec3 cb, vec3 cs) { <body> }`.
 * Each body must `return` a `vec3`. Mirrors {@link blendChannel} / {@link blendRgb}.
 */
export const BLEND_GLSL: Readonly<Record<BlendMode, string>> = {
  [BlendMode.Normal]: "return cs;",
  [BlendMode.Multiply]: "return cb * cs;",
  [BlendMode.Screen]: "return cb + cs - cb * cs;",
  [BlendMode.Overlay]: "return pf_hardLight(cs, cb);",
  [BlendMode.Darken]: "return min(cb, cs);",
  [BlendMode.Lighten]: "return max(cb, cs);",
  [BlendMode.ColorDodge]:
    "vec3 r = mix(min(vec3(1.0), cb / max(1.0 - cs, vec3(1e-6))), vec3(1.0), step(1.0, cs));\n  return r * step(1e-6, cb);",
  [BlendMode.ColorBurn]:
    "vec3 r = (1.0 - min(vec3(1.0), (1.0 - cb) / max(cs, vec3(1e-6)))) * step(1e-6, cs);\n  return mix(r, vec3(1.0), step(1.0, cb));",
  [BlendMode.HardLight]: "return pf_hardLight(cb, cs);",
  [BlendMode.SoftLight]:
    "vec3 d = mix(((16.0 * cb - 12.0) * cb + 4.0) * cb, sqrt(cb), step(0.25, cb));\n  return mix(cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb), cb + (2.0 * cs - 1.0) * (d - cb), step(0.5, cs));",
  [BlendMode.Difference]: "return abs(cb - cs);",
  [BlendMode.Exclusion]: "return cb + cs - 2.0 * cb * cs;",
  [BlendMode.Hue]: "return pf_setLum(pf_setSat(cs, pf_sat(cb)), pf_lum(cb));",
  [BlendMode.Saturation]: "return pf_setLum(pf_setSat(cb, pf_sat(cs)), pf_lum(cb));",
  [BlendMode.Color]: "return pf_setLum(cs, pf_lum(cb));",
  [BlendMode.Luminosity]: "return pf_setLum(cb, pf_lum(cs));",
};
