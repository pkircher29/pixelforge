/**
 * Add Noise: seeded per-pixel hash noise (uniform or Gaussian), colour or monochrome.
 * Amount 100 % = ±1.0 uniform / sigma 0.5 Gaussian in 0..1 channel units.
 */

import { clamp01, mapPixels } from "./cpu";
import { PF_HASH_GLSL, gaussianFromUniforms, hash01 } from "./random";
import { bool, num, str, type OpDef } from "./types";

export function noiseValue(x: number, y: number, seed: number, channel: number, gaussian: boolean): number {
  const u1 = hash01(x, y, seed, channel * 2);
  if (!gaussian) return u1 * 2 - 1;
  const u2 = hash01(x, y, seed, channel * 2 + 1);
  return gaussianFromUniforms(u1, u2) * 0.5;
}

export const addNoise: OpDef = {
  id: "add-noise",
  label: "Add Noise",
  menu: "Filter/Noise",
  keywords: ["grain", "film", "dither"],
  params: [
    { kind: "number", id: "amount", label: "Amount", min: 0, max: 100, step: 0.5, default: 12.5, unit: "%" },
    {
      kind: "select",
      id: "distribution",
      label: "Distribution",
      options: [
        { value: "uniform", label: "Uniform" },
        { value: "gaussian", label: "Gaussian" },
      ],
      default: "uniform",
    },
    { kind: "boolean", id: "monochrome", label: "Monochromatic", default: false },
    { kind: "number", id: "seed", label: "Seed", min: 0, max: 9999, step: 1, default: 1 },
  ],
  glsl: (p) => [
    {
      source: `
${PF_HASH_GLSL}
uniform float u_amount;
uniform bool u_gaussian;
uniform bool u_mono;
uniform int u_seed;
float pf_noise(ivec2 p, int ch) {
  float u1 = pf_hash01(p, u_seed, ch * 2);
  if (!u_gaussian) return u1 * 2.0 - 1.0;
  float u2 = pf_hash01(p, u_seed, ch * 2 + 1);
  return pf_gauss(u1, u2) * 0.5;
}
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  vec3 n;
  if (u_mono) n = vec3(pf_noise(p, 0));
  else n = vec3(pf_noise(p, 0), pf_noise(p, 1), pf_noise(p, 2));
  c.rgb = clamp(c.rgb + n * u_amount, 0.0, 1.0);
  return c;
}`,
      uniforms: {
        u_amount: num(p, "amount", 12.5) / 100,
        u_gaussian: str(p, "distribution", "uniform") === "gaussian",
        u_mono: bool(p, "monochrome"),
        u_seed: Int32Array.of(Math.round(num(p, "seed", 1))),
      },
    },
  ],
  cpu: (src, p) => {
    const amount = num(p, "amount", 12.5) / 100;
    const gaussian = str(p, "distribution", "uniform") === "gaussian";
    const mono = bool(p, "monochrome");
    const seed = Math.round(num(p, "seed", 1));
    return mapPixels(src, (r, g, b, a, out, x, y) => {
      const n0 = noiseValue(x, y, seed, 0, gaussian);
      const n1 = mono ? n0 : noiseValue(x, y, seed, 1, gaussian);
      const n2 = mono ? n0 : noiseValue(x, y, seed, 2, gaussian);
      out[0] = clamp01(r + n0 * amount);
      out[1] = clamp01(g + n1 * amount);
      out[2] = clamp01(b + n2 * amount);
      out[3] = a;
    });
  },
};
