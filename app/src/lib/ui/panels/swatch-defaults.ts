/**
 * Photoshop's default swatch set (pure data), 121 colors. The flat "Default" grid follows the
 * classic `Default.aco` order: the 12 RGB/CMYK primaries (PS's exact values), White /
 * Neutral Gray / Black, then the five hue families (Pastel, Light, Pure, Dark, Darker ×
 * PS's 16 hue names), a 16-step gray ramp and the cool / warm brown ramps. Family values are derived from HSB with
 * PS's tint/shade ratios, so they read like the originals but are not byte-exact.
 * PS CC 2020's folders (Pastel, Light, Pure, Dark, Darker, Grayscale) group the same colors.
 */
import { hsbToRgb, type RGB } from "./color-model";

export interface SwatchDef {
  name: string;
  color: RGB;
}

export interface SwatchGroupDef {
  name: string;
  swatches: SwatchDef[];
}

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

/** PS "RGB Red … CMYK Magenta". */
export const PRIMARIES: readonly SwatchDef[] = [
  { name: "RGB Red", color: rgb(255, 0, 0) },
  { name: "RGB Yellow", color: rgb(255, 255, 0) },
  { name: "RGB Green", color: rgb(0, 255, 0) },
  { name: "RGB Cyan", color: rgb(0, 255, 255) },
  { name: "RGB Blue", color: rgb(0, 0, 255) },
  { name: "RGB Magenta", color: rgb(255, 0, 255) },
  { name: "CMYK Red", color: rgb(237, 28, 36) },
  { name: "CMYK Yellow", color: rgb(255, 241, 0) },
  { name: "CMYK Green", color: rgb(0, 166, 81) },
  { name: "CMYK Cyan", color: rgb(0, 174, 239) },
  { name: "CMYK Blue", color: rgb(46, 49, 146) },
  { name: "CMYK Magenta", color: rgb(236, 0, 140) },
  { name: "White", color: rgb(255, 255, 255) },
  { name: "Neutral Gray", color: rgb(128, 128, 128) },
  { name: "Black", color: rgb(0, 0, 0) },
];

/** PS's 16 hue names, in swatch order, with their hue angles. */
export const HUE_NAMES: readonly { name: string; h: number }[] = [
  { name: "Red", h: 0 },
  { name: "Red Orange", h: 15 },
  { name: "Yellow Orange", h: 35 },
  { name: "Yellow", h: 55 },
  { name: "Pea Green", h: 75 },
  { name: "Yellow Green", h: 95 },
  { name: "Green", h: 120 },
  { name: "Green Cyan", h: 160 },
  { name: "Cyan", h: 180 },
  { name: "Cyan Blue", h: 205 },
  { name: "Blue", h: 230 },
  { name: "Blue Violet", h: 255 },
  { name: "Violet", h: 275 },
  { name: "Violet Magenta", h: 290 },
  { name: "Magenta", h: 305 },
  { name: "Magenta Red", h: 335 },
];

/** Tint / shade per family: PS Pastel ≈ 35 % sat, Light ≈ 60 %, Pure = 100 %, Dark ≈ 70 % bright, Darker ≈ 45 %. */
export const FAMILIES: readonly { name: string; s: number; b: number }[] = [
  { name: "Pastel", s: 35, b: 100 },
  { name: "Light", s: 60, b: 100 },
  { name: "Pure", s: 100, b: 100 },
  { name: "Dark", s: 100, b: 70 },
  { name: "Darker", s: 100, b: 45 },
];

export function familySwatches(family: { name: string; s: number; b: number }): SwatchDef[] {
  return HUE_NAMES.map((hue) => ({ name: `${family.name} ${hue.name}`, color: hsbToRgb({ h: hue.h, s: family.s, b: family.b }) }));
}

/** White … Black in 16 steps, PS's "Grayscale" folder plus the classic ramp. */
export function grayRamp(): SwatchDef[] {
  const out: SwatchDef[] = [];
  for (let i = 0; i < 16; i++) {
    const pct = Math.round((i / 15) * 100);
    const v = Math.round(255 * (1 - i / 15));
    out.push({ name: i === 0 ? "White" : i === 15 ? "Black" : `${pct}% Gray`, color: rgb(v, v, v) });
  }
  return out;
}

/** PS's cool / warm brown ramps (pale → darker). */
export const BROWNS: readonly SwatchDef[] = [
  { name: "Pale Cool Brown", color: rgb(199, 178, 153) },
  { name: "Light Cool Brown", color: rgb(153, 134, 117) },
  { name: "Medium Cool Brown", color: rgb(115, 99, 87) },
  { name: "Dark Cool Brown", color: rgb(83, 71, 65) },
  { name: "Darker Cool Brown", color: rgb(55, 48, 45) },
  { name: "Pale Warm Brown", color: rgb(198, 156, 109) },
  { name: "Light Warm Brown", color: rgb(166, 124, 82) },
  { name: "Medium Warm Brown", color: rgb(140, 98, 57) },
  { name: "Dark Warm Brown", color: rgb(117, 76, 36) },
  { name: "Darker Warm Brown", color: rgb(96, 57, 19) },
];

/** The flat classic "Default" list: primaries, 5 hue families, gray ramp, browns. */
export function defaultSwatches(): SwatchDef[] {
  return [...PRIMARIES, ...FAMILIES.flatMap(familySwatches), ...grayRamp(), ...BROWNS];
}

/** PS CC 2020+ folders. */
export function defaultGroups(): SwatchGroupDef[] {
  return [...FAMILIES.map((f) => ({ name: f.name, swatches: familySwatches(f) })), { name: "Grayscale", swatches: grayRamp() }];
}
