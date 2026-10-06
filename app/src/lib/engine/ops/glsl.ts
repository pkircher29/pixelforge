/**
 * GLSL preamble shared by every op pass. The standalone runner (`lib/filters/gpu.ts`)
 * and the compositor's adjustment-layer path (`composite/GlCompositor.ts`) both compile
 * `buildOpFragmentSource(pass.source)`, so an op's GLSL is written once.
 *
 * The preamble supplies:
 * - `uniform sampler2D u_image`  previous pass output (or the input for pass 0)
 * - `uniform sampler2D u_source` the original input, always
 * - `uniform ivec2 u_size`       size of `u_image`
 * - `uniform ivec2 u_sourceSize` size of `u_source`
 * - `uniform ivec2 u_outSize`    size of the current render target
 * - `vec4 pf_fetch(ivec2 p)` / `pf_fetchSource(ivec2 p)` clamped texel fetches
 * - `vec4 pf_sample(vec2 uv)`  bilinear sample of `u_image` at 0..1 uv
 * - `pf_luma`, `pf_premul`, `pf_unpremul`
 */

/** Full-screen triangle vertex shader (no vertex buffer). */
export const OP_VERT = `#version 300 es
precision highp float;
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const OP_PREAMBLE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_image;
uniform sampler2D u_source;
uniform ivec2 u_size;
uniform ivec2 u_sourceSize;
uniform ivec2 u_outSize;
out vec4 outColor;

vec4 pf_fetch(ivec2 p) {
  return texelFetch(u_image, clamp(p, ivec2(0), u_size - 1), 0);
}
vec4 pf_fetchSource(ivec2 p) {
  return texelFetch(u_source, clamp(p, ivec2(0), u_sourceSize - 1), 0);
}
vec4 pf_sample(vec2 uv) {
  return texture(u_image, uv);
}
float pf_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 pf_premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 pf_unpremul(vec4 c) { return c.a >= 0.5 / 255.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
`;

export const OP_MAIN = `
void main() {
  outColor = pf_op(ivec2(gl_FragCoord.xy));
}
`;

/** Full fragment source for a pass whose `source` defines `vec4 pf_op(ivec2 p)`. */
export function buildOpFragmentSource(passSource: string): string {
  return OP_PREAMBLE + passSource + OP_MAIN;
}
