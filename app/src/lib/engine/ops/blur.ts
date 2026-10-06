/**
 * Gaussian Blur and Motion Blur.
 *
 * GPU Gaussian: separable two-pass in premultiplied RGB. Above sigma 16 the image is box
 * downsampled by `k = ceil(sigma / 16)`, blurred with `sigma / k`, and bilinearly
 * upsampled — keeps the per-fragment tap count bounded (<= 97 per pass) for sigma up to
 * 250. CPU: exact separable kernel up to sigma 20, three running-sum box passes above.
 * The two big-sigma approximations differ by a few levels on hard edges (by design).
 */

import { Raster } from "../raster";
import { fromPremul, gaussianBlurRaster, toPremul } from "./cpu";
import { num, type GlslPass, type OpDef } from "./types";

const BLUR_1D = (axis: "x" | "y", unpremulOut: boolean): string => `
uniform float u_sigma;
uniform int u_radius;
vec4 pf_op(ivec2 p) {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -u_radius; i <= u_radius; i++) {
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    vec4 s = pf_fetch(p + ivec2(${axis === "x" ? "i, 0" : "0, i"}));
    acc += ${axis === "x" ? "pf_premul(s)" : "s"} * w;
    wsum += w;
  }
  acc /= wsum;
  return ${unpremulOut ? "pf_unpremul(acc)" : "acc"};
}`;

/** Box-average `u_k x u_k` input texels into each output texel (premultiplied). */
const DOWNSAMPLE = `
uniform int u_k;
vec4 pf_op(ivec2 p) {
  vec4 acc = vec4(0.0);
  ivec2 o = p * u_k;
  for (int y = 0; y < u_k; y++) {
    for (int x = 0; x < u_k; x++) acc += pf_premul(pf_fetch(o + ivec2(x, y)));
  }
  return acc / float(u_k * u_k);
}`;

/** Bilinear upsample of the (premultiplied) low-res image to the output size. */
const UPSAMPLE = (unpremulOut: boolean): string => `
vec4 pf_op(ivec2 p) {
  vec2 uv = (vec2(p) + 0.5) / vec2(u_outSize);
  vec4 c = pf_sample(uv);
  return ${unpremulOut ? "pf_unpremul(c)" : "c"};
}`;

/**
 * GLSL passes for a Gaussian blur. With `premulOut` the final pass leaves the result
 * premultiplied (for a following combine pass such as Unsharp Mask).
 */
export function gaussianPasses(sigma: number, premulOut = false): GlslPass[] {
  if (sigma <= 0) {
    return [{ source: `vec4 pf_op(ivec2 p) { vec4 c = pf_fetch(p); return ${premulOut ? "pf_premul(c)" : "c"}; }` }];
  }
  if (sigma <= 16) {
    const radius = Math.max(1, Math.ceil(sigma * 3));
    return [
      { source: BLUR_1D("x", false), uniforms: { u_sigma: sigma, u_radius: Int32Array.of(radius) } },
      { source: BLUR_1D("y", !premulOut), uniforms: { u_sigma: sigma, u_radius: Int32Array.of(radius) } },
    ];
  }
  const k = Math.ceil(sigma / 16);
  const s = sigma / k;
  const radius = Math.max(1, Math.ceil(s * 3));
  const scale = 1 / k;
  // The low-res blur passes read premultiplied data from the downsample pass, so the
  // "x" pass must not premultiply again: use the y-variant source for both axes.
  const blurX = BLUR_1D("x", false).replace("pf_premul(s)", "s");
  return [
    { source: DOWNSAMPLE, uniforms: { u_k: Int32Array.of(k) }, scale },
    { source: blurX, uniforms: { u_sigma: s, u_radius: Int32Array.of(radius) }, scale },
    { source: BLUR_1D("y", false), uniforms: { u_sigma: s, u_radius: Int32Array.of(radius) }, scale },
    { source: UPSAMPLE(!premulOut) },
  ];
}

export const gaussianBlur: OpDef = {
  id: "gaussian-blur",
  label: "Gaussian Blur",
  menu: "Filter/Blur",
  keywords: ["soften", "smooth"],
  params: [{ kind: "number", id: "radius", label: "Radius", min: 0.1, max: 250, step: 0.1, default: 2, unit: "px" }],
  margin: (p) => Math.ceil(num(p, "radius", 2) * 3) + 2,
  glsl: (p) => gaussianPasses(num(p, "radius", 2)),
  cpu: (src, p) => gaussianBlurRaster(src, num(p, "radius", 2)),
};

export const motionBlur: OpDef = {
  id: "motion-blur",
  label: "Motion Blur",
  menu: "Filter/Blur",
  keywords: ["directional", "streak"],
  params: [
    { kind: "number", id: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, unit: "°" },
    { kind: "number", id: "distance", label: "Distance", min: 1, max: 500, step: 1, default: 10, unit: "px" },
  ],
  margin: (p) => Math.ceil(num(p, "distance", 10) / 2) + 1,
  glsl: (p) => {
    const a = (num(p, "angle") * Math.PI) / 180;
    const n = Math.floor(num(p, "distance", 10) / 2);
    return [
      {
        source: `
uniform vec2 u_dir;
uniform int u_n;
vec4 pf_op(ivec2 p) {
  vec4 acc = vec4(0.0);
  for (int i = -u_n; i <= u_n; i++) {
    vec2 o = u_dir * float(i);
    // 0.501: keep float32 ties (e.g. sin 30 deg * odd i) from flipping vs the CPU path.
    acc += pf_premul(pf_fetch(p + ivec2(floor(o + 0.501))));
  }
  return pf_unpremul(acc / float(2 * u_n + 1));
}`,
        uniforms: { u_dir: [Math.cos(a), -Math.sin(a)], u_n: Int32Array.of(n) },
      },
    ];
  },
  cpu: (src, p) => {
    const a = (num(p, "angle") * Math.PI) / 180;
    const n = Math.floor(num(p, "distance", 10) / 2);
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const w = src.width;
    const h = src.height;
    const f = toPremul(src);
    const out = new Float32Array(f.length);
    const ox = new Int32Array(2 * n + 1);
    const oy = new Int32Array(2 * n + 1);
    for (let i = -n; i <= n; i++) {
      ox[i + n] = Math.floor(dx * i + 0.501);
      oy[i + n] = Math.floor(dy * i + 0.501);
    }
    const inv = 1 / (2 * n + 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let al = 0;
        for (let k = 0; k < ox.length; k++) {
          let sx = x + ox[k]!;
          let sy = y + oy[k]!;
          sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
          sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
          const i = (sy * w + sx) * 4;
          r += f[i]!;
          g += f[i + 1]!;
          b += f[i + 2]!;
          al += f[i + 3]!;
        }
        const o = (y * w + x) * 4;
        out[o] = r * inv;
        out[o + 1] = g * inv;
        out[o + 2] = b * inv;
        out[o + 3] = al * inv;
      }
    }
    return fromPremul(out, w, h);
  },
};

/** Re-exported for tests/demo. */
export function blurRaster(src: Raster, sigma: number): Raster {
  return gaussianBlurRaster(src, sigma);
}
