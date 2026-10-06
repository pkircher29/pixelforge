/**
 * Brightness/Contrast (legacy-style). Brightness adds `b/255`; contrast scales around
 * mid-grey with a slope of 0 (at -100) .. 1 (at 0) .. 4 (at +100).
 */

import { applyLut, makeLut } from "../cpu";
import { num, type OpDef } from "../types";

export function contrastSlope(contrast: number): number {
  return contrast >= 0 ? 1 + (3 * contrast) / 100 : 1 + contrast / 100;
}

export const brightnessContrast: OpDef = {
  id: "brightness-contrast",
  label: "Brightness/Contrast",
  menu: "Image/Adjustments",
  histogram: true,
  keywords: ["bright", "contrast", "tone"],
  params: [
    { kind: "number", id: "brightness", label: "Brightness", min: -150, max: 150, step: 1, default: 0 },
    { kind: "number", id: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
  ],
  glsl: (p) => [
    {
      source: `
uniform float u_brightness;
uniform float u_slope;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  c.rgb = clamp((c.rgb - 0.5) * u_slope + 0.5 + u_brightness / 255.0, 0.0, 1.0);
  return c;
}`,
      uniforms: { u_brightness: num(p, "brightness"), u_slope: contrastSlope(num(p, "contrast")) },
    },
  ],
  cpu: (src, p) => {
    const b = num(p, "brightness") / 255;
    const f = contrastSlope(num(p, "contrast"));
    const lut = makeLut((v) => (v - 0.5) * f + 0.5 + b);
    return applyLut(src, lut, lut, lut);
  },
};
