/**
 * Hue/Saturation/Lightness with Colorize. Works in HSL. Saturation scales the HSL
 * saturation by `1 + s/100` (clamped); lightness blends towards white/black. Colorize
 * replaces hue with the slider (0..360 from -180..180) and saturation with `max(s, 0)`.
 */

import { luma, mapPixels, clamp01 } from "./cpu";
import { bool, num, type OpDef } from "./types";
import { HSL_GLSL, LIGHTNESS_GLSL, applyLightness, hslToRgb, rgbToHsl } from "./color";

export const hueSaturation: OpDef = {
  id: "hue-saturation",
  label: "Hue/Saturation",
  menu: "Image/Adjustments",
  shortcut: "CmdOrCtrl+U",
  keywords: ["hsl", "colorize", "tint", "lightness"],
  params: [
    { kind: "number", id: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0, unit: "°" },
    { kind: "number", id: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
    { kind: "number", id: "lightness", label: "Lightness", min: -100, max: 100, step: 1, default: 0 },
    { kind: "boolean", id: "colorize", label: "Colorize", default: false },
  ],
  glsl: (p) => [
    {
      source: `
${HSL_GLSL}
${LIGHTNESS_GLSL}
uniform float u_hue;
uniform float u_sat;
uniform float u_light;
uniform bool u_colorize;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  vec3 rgb;
  if (u_colorize) {
    float l = pf_luma(c.rgb);
    rgb = pf_hsl2rgb(vec3(fract(u_hue / 360.0), clamp(max(u_sat, 0.0) / 100.0, 0.0, 1.0), l));
  } else {
    vec3 hsl = pf_rgb2hsl(c.rgb);
    hsl.x = fract(hsl.x + u_hue / 360.0);
    hsl.y = clamp(hsl.y * (1.0 + u_sat / 100.0), 0.0, 1.0);
    rgb = pf_hsl2rgb(hsl);
  }
  c.rgb = clamp(pf_lightness(rgb, u_light), 0.0, 1.0);
  return c;
}`,
      uniforms: {
        u_hue: num(p, "hue"),
        u_sat: num(p, "saturation"),
        u_light: num(p, "lightness"),
        u_colorize: bool(p, "colorize"),
      },
    },
  ],
  cpu: (src, p) => {
    const hue = num(p, "hue");
    const sat = num(p, "saturation");
    const light = num(p, "lightness");
    const colorize = bool(p, "colorize");
    const hsl = new Float32Array(3);
    const rgb = new Float32Array(3);
    return mapPixels(src, (r, g, b, a, out) => {
      if (colorize) {
        const l = luma(r, g, b);
        let h = hue / 360;
        h -= Math.floor(h);
        hslToRgb(h, clamp01(Math.max(sat, 0) / 100), l, rgb);
      } else {
        rgbToHsl(r, g, b, hsl);
        let h = hsl[0]! + hue / 360;
        h -= Math.floor(h);
        hslToRgb(h, clamp01(hsl[1]! * (1 + sat / 100)), hsl[2]!, rgb);
      }
      out[0] = clamp01(applyLightness(rgb[0]!, light));
      out[1] = clamp01(applyLightness(rgb[1]!, light));
      out[2] = clamp01(applyLightness(rgb[2]!, light));
      out[3] = a;
    });
  },
};
