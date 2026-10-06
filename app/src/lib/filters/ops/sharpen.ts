/**
 * Sharpen (3x3 box high-pass) and Unsharp Mask (Gaussian high-pass with threshold).
 * Both operate on premultiplied RGB: `out = c + amount * (c - blur(c))`.
 */

import { box3Premul, fromPremul, gaussianBlurPremul, toPremul } from "../cpu";
import { num, type OpDef } from "../types";
import { gaussianPasses } from "./blur";

export const sharpen: OpDef = {
  id: "sharpen",
  label: "Sharpen",
  menu: "Filter/Sharpen",
  keywords: ["crisp", "detail"],
  params: [{ kind: "number", id: "amount", label: "Amount", min: 1, max: 500, step: 1, default: 100, unit: "%" }],
  margin: () => 2,
  glsl: (p) => [
    {
      source: `
uniform float u_amount;
vec4 pf_op(ivec2 p) {
  vec4 acc = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) acc += pf_premul(pf_fetch(p + ivec2(x, y)));
  acc /= 9.0;
  vec4 c = pf_premul(pf_fetch(p));
  vec4 r = c + (c - acc) * u_amount;
  r.a = c.a;
  r.rgb = clamp(r.rgb, 0.0, r.a);
  return pf_unpremul(r);
}`,
      uniforms: { u_amount: num(p, "amount", 100) / 100 },
    },
  ],
  cpu: (src, p) => {
    const amount = num(p, "amount", 100) / 100;
    const f = toPremul(src);
    const blur = box3Premul(f, src.width, src.height);
    const out = new Float32Array(f.length);
    for (let i = 0; i < f.length; i += 4) {
      const a = f[i + 3]!;
      for (let c = 0; c < 3; c++) {
        const v = f[i + c]! + (f[i + c]! - blur[i + c]!) * amount;
        out[i + c] = v < 0 ? 0 : v > a ? a : v;
      }
      out[i + 3] = a;
    }
    return fromPremul(out, src.width, src.height);
  },
};

export const unsharpMask: OpDef = {
  id: "unsharp-mask",
  label: "Unsharp Mask",
  menu: "Filter/Sharpen",
  keywords: ["usm", "sharpen", "radius", "threshold"],
  params: [
    { kind: "number", id: "amount", label: "Amount", min: 1, max: 500, step: 1, default: 100, unit: "%" },
    { kind: "number", id: "radius", label: "Radius", min: 0.1, max: 250, step: 0.1, default: 1, unit: "px" },
    { kind: "number", id: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0, unit: "levels" },
  ],
  margin: (p) => Math.ceil(num(p, "radius", 1) * 3) + 2,
  glsl: (p) => [
    ...gaussianPasses(num(p, "radius", 1), true),
    {
      source: `
uniform float u_amount;
uniform float u_threshold;
vec4 pf_op(ivec2 p) {
  vec4 blur = pf_fetch(p);
  vec4 c = pf_premul(pf_fetchSource(p));
  vec3 d = c.rgb - blur.rgb;
  // Soft gate 2 levels wide around the threshold (keeps GPU/CPU rounding from flipping it).
  vec3 keep = clamp((abs(d) - u_threshold + 1.0 / 255.0) * 127.5, 0.0, 1.0);
  vec4 r = c;
  r.rgb = clamp(c.rgb + d * keep * u_amount, 0.0, c.a);
  return pf_unpremul(r);
}`,
      uniforms: { u_amount: num(p, "amount", 100) / 100, u_threshold: num(p, "threshold", 0) / 255 },
    },
  ],
  cpu: (src, p) => {
    const amount = num(p, "amount", 100) / 100;
    const threshold = num(p, "threshold", 0); // in 0..255 premultiplied units
    const f = toPremul(src);
    const blur = gaussianBlurPremul(f, src.width, src.height, num(p, "radius", 1));
    const out = new Float32Array(f.length);
    for (let i = 0; i < f.length; i += 4) {
      const a = f[i + 3]!;
      for (let c = 0; c < 3; c++) {
        const d = f[i + c]! - blur[i + c]!;
        const keep = Math.min(1, Math.max(0, (Math.abs(d) - threshold + 1) / 2));
        const v = f[i + c]! + d * amount * keep;
        out[i + c] = v < 0 ? 0 : v > a ? a : v;
      }
      out[i + 3] = a;
    }
    return fromPremul(out, src.width, src.height);
  },
};
