/**
 * Point ops with trivial math: Invert, Desaturate, Threshold, Posterize, Exposure.
 */

import { applyLut, clamp01, luma, makeLut, mapPixels } from "./cpu";
import { num, type OpDef } from "./types";

export const invert: OpDef = {
  id: "invert",
  label: "Invert",
  menu: "Image/Adjustments",
  shortcut: "CmdOrCtrl+I",
  instant: true,
  keywords: ["negative"],
  params: [],
  glsl: () => [
    {
      source: `
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  c.rgb = 1.0 - c.rgb;
  return c;
}`,
    },
  ],
  cpu: (src) => {
    const lut = makeLut((v) => 1 - v);
    return applyLut(src, lut, lut, lut);
  },
};

/** Rec.709 luma (documented deviation from Photoshop's HSL-lightness desaturate). */
export const desaturate: OpDef = {
  id: "desaturate",
  label: "Desaturate",
  menu: "Image/Adjustments",
  shortcut: "CmdOrCtrl+Shift+U",
  instant: true,
  keywords: ["grayscale", "black and white", "mono"],
  params: [],
  glsl: () => [
    {
      source: `
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  c.rgb = vec3(pf_luma(c.rgb));
  return c;
}`,
    },
  ],
  cpu: (src) =>
    mapPixels(src, (r, g, b, a, out) => {
      const l = luma(r, g, b);
      out[0] = out[1] = out[2] = l;
      out[3] = a;
    }),
};

export const threshold: OpDef = {
  id: "threshold",
  label: "Threshold",
  menu: "Image/Adjustments",
  histogram: true,
  keywords: ["binary", "black and white"],
  params: [{ kind: "number", id: "level", label: "Threshold level", min: 1, max: 255, step: 1, default: 128 }],
  glsl: (p) => [
    {
      source: `
uniform float u_level;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  float l = floor(pf_luma(c.rgb) * 255.0 + 0.5);
  c.rgb = vec3(l >= u_level ? 1.0 : 0.0);
  return c;
}`,
      uniforms: { u_level: num(p, "level", 128) },
    },
  ],
  cpu: (src, p) => {
    const level = num(p, "level", 128);
    return mapPixels(src, (r, g, b, a, out) => {
      const l = Math.floor(luma(r, g, b) * 255 + 0.5);
      const v = l >= level ? 1 : 0;
      out[0] = out[1] = out[2] = v;
      out[3] = a;
    });
  },
};

/** `levels` output values per channel: `floor(v * levels) / (levels - 1)`, clamped. */
export function posterizeFn(v: number, levels: number): number {
  return clamp01(Math.floor(v * levels) / (levels - 1));
}

export const posterize: OpDef = {
  id: "posterize",
  label: "Posterize",
  menu: "Image/Adjustments",
  keywords: ["quantize", "levels"],
  params: [{ kind: "number", id: "levels", label: "Levels", min: 2, max: 255, step: 1, default: 4 }],
  glsl: (p) => [
    {
      source: `
uniform float u_levels;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  c.rgb = clamp(floor(c.rgb * u_levels) / (u_levels - 1.0), 0.0, 1.0);
  return c;
}`,
      uniforms: { u_levels: Math.max(2, Math.round(num(p, "levels", 4))) },
    },
  ],
  cpu: (src, p) => {
    const levels = Math.max(2, Math.round(num(p, "levels", 4)));
    const lut = makeLut((v) => posterizeFn(v, levels));
    return applyLut(src, lut, lut, lut);
  },
};

/** Exposure in stops (`v * 2^e`), offset (added) and gamma correction (`v^(1/g)`). */
export const exposure: OpDef = {
  id: "exposure",
  label: "Exposure",
  menu: "Image/Adjustments",
  histogram: true,
  keywords: ["stops", "ev", "offset", "gamma"],
  params: [
    { kind: "number", id: "exposure", label: "Exposure", min: -5, max: 5, step: 0.01, default: 0, unit: "EV" },
    { kind: "number", id: "offset", label: "Offset", min: -0.5, max: 0.5, step: 0.001, default: 0 },
    { kind: "number", id: "gamma", label: "Gamma correction", min: 0.1, max: 3, step: 0.01, default: 1 },
  ],
  glsl: (p) => [
    {
      source: `
uniform float u_gain;
uniform float u_offset;
uniform float u_invGamma;
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  vec3 v = clamp(c.rgb * u_gain + u_offset, 0.0, 1.0);
  c.rgb = pow(v, vec3(u_invGamma));
  return c;
}`,
      uniforms: {
        u_gain: Math.pow(2, num(p, "exposure")),
        u_offset: num(p, "offset"),
        u_invGamma: 1 / Math.max(0.01, num(p, "gamma", 1)),
      },
    },
  ],
  cpu: (src, p) => {
    const gain = Math.pow(2, num(p, "exposure"));
    const offset = num(p, "offset");
    const invGamma = 1 / Math.max(0.01, num(p, "gamma", 1));
    const lut = makeLut((v) => Math.pow(clamp01(v * gain + offset), invGamma));
    return applyLut(src, lut, lut, lut);
  },
};
