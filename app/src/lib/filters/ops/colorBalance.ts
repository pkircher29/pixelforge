/**
 * Color Balance: cyan-red / magenta-green / yellow-blue shifts weighted by tonal range
 * (shadows / midtones / highlights, triangular weights over luma). A slider at ±100
 * shifts a channel by at most ±0.3. "Preserve luminosity" restores the original luma.
 */

import { clamp01, luma, mapPixels } from "../cpu";
import { bool, num, type NumberParam, type OpDef, type ParamValues } from "../types";

const RANGES = ["shadows", "midtones", "highlights"] as const;
type Range = (typeof RANGES)[number];
const AXES = [
  { id: "cyanRed", label: "Cyan / Red" },
  { id: "magentaGreen", label: "Magenta / Green" },
  { id: "yellowBlue", label: "Yellow / Blue" },
] as const;

const STRENGTH = 0.3;

function rangeParams(r: Range): NumberParam[] {
  return AXES.map((a) => ({
    kind: "number",
    id: `${a.id}_${r}`,
    label: a.label,
    min: -100,
    max: 100,
    step: 1,
    default: 0,
    group: r,
  }));
}

/** [r, g, b] shift for a range, in -1..1 units. */
function shifts(p: ParamValues, r: Range): [number, number, number] {
  return [num(p, `cyanRed_${r}`) / 100, num(p, `magentaGreen_${r}`) / 100, num(p, `yellowBlue_${r}`) / 100];
}

export function rangeWeights(l: number): [number, number, number] {
  const s = clamp01((0.5 - l) / 0.5);
  const h = clamp01((l - 0.5) / 0.5);
  return [s, 1 - s - h, h];
}

export const colorBalance: OpDef = {
  id: "color-balance",
  label: "Color Balance",
  menu: "Image/Adjustments",
  shortcut: "CmdOrCtrl+B",
  keywords: ["tint", "warm", "cool", "shadows", "midtones", "highlights"],
  groupSelector: {
    id: "range",
    label: "Tone range",
    options: [
      { value: "shadows", label: "Shadows" },
      { value: "midtones", label: "Midtones" },
      { value: "highlights", label: "Highlights" },
    ],
    default: "midtones",
  },
  params: [
    ...RANGES.flatMap(rangeParams),
    { kind: "boolean", id: "preserveLuminosity", label: "Preserve luminosity", default: true },
  ],
  glsl: (p) => [
    {
      source: `
uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform bool u_preserve;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  float l = pf_luma(c.rgb);
  float ws = clamp((0.5 - l) / 0.5, 0.0, 1.0);
  float wh = clamp((l - 0.5) / 0.5, 0.0, 1.0);
  float wm = 1.0 - ws - wh;
  vec3 rgb = c.rgb + (u_shadows * ws + u_midtones * wm + u_highlights * wh) * ${STRENGTH.toFixed(3)};
  if (u_preserve) rgb += l - pf_luma(rgb);
  c.rgb = clamp(rgb, 0.0, 1.0);
  return c;
}`,
      uniforms: {
        u_shadows: shifts(p, "shadows"),
        u_midtones: shifts(p, "midtones"),
        u_highlights: shifts(p, "highlights"),
        u_preserve: bool(p, "preserveLuminosity", true),
      },
    },
  ],
  cpu: (src, p) => {
    const s = shifts(p, "shadows");
    const m = shifts(p, "midtones");
    const h = shifts(p, "highlights");
    const preserve = bool(p, "preserveLuminosity", true);
    return mapPixels(src, (r, g, b, a, out) => {
      const l = luma(r, g, b);
      const [ws, wm, wh] = rangeWeights(l);
      let nr = r + (s[0] * ws + m[0] * wm + h[0] * wh) * STRENGTH;
      let ng = g + (s[1] * ws + m[1] * wm + h[1] * wh) * STRENGTH;
      let nb = b + (s[2] * ws + m[2] * wm + h[2] * wh) * STRENGTH;
      if (preserve) {
        const d = l - luma(nr, ng, nb);
        nr += d;
        ng += d;
        nb += d;
      }
      out[0] = clamp01(nr);
      out[1] = clamp01(ng);
      out[2] = clamp01(nb);
      out[3] = a;
    });
  },
};
