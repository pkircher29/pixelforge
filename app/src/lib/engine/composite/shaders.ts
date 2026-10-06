/**
 * GLSL ES 3.00 sources for the WebGL2 compositor. Pure string generation (no GL calls)
 * so it is unit-testable in jsdom. Blend formulas come from `../blend.ts`.
 */

import { BLEND_GLSL, BLEND_GLSL_HELPERS, BLEND_MODES, BLEND_MODE_INDEX } from "../blend";
import type { BlendMode } from "../types";

/** Full-screen triangle; no vertex buffer needed. */
export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** `vec3 pf_blend(int mode, vec3 cb, vec3 cs)` dispatching over every mode. */
export function buildBlendSwitch(): string {
  const cases = BLEND_MODES.map(
    (m) => `    case ${BLEND_MODE_INDEX[m]}: { ${BLEND_GLSL[m].replace(/\n\s*/g, " ")} }`,
  ).join("\n");
  return `vec3 pf_blend(int mode, vec3 cb, vec3 cs) {
  switch (mode) {
${cases}
    default: return cs;
  }
  return cs;
}
`;
}

/** A specialised `pf_blend` for exactly one mode (ignores `mode`), for per-mode programs. */
export function buildBlendSingle(mode: BlendMode): string {
  return `vec3 pf_blend(int mode, vec3 cb, vec3 cs) {
  ${BLEND_GLSL[mode].replace(/\n\s*/g, " ")}
}
`;
}

/**
 * One blend pass: `out = blend(prev, layer)` in **premultiplied** alpha.
 *
 * Uniforms:
 * - `u_prev` premultiplied composite so far (ignored when `u_prevValid` is false)
 * - `u_layer` the source texture: straight alpha, or premultiplied when `u_srcPremul`
 * - `u_mask` optional layer mask (red channel), enabled by `u_hasMask`
 * - `u_layerRect` x, y, w, h of the source in doc pixels
 * - `u_mode`, `u_opacity`
 *
 * `mode` selects a single-mode specialisation or the `switch` dispatcher (`"all"`).
 */
export function buildBlendFragment(mode: BlendMode | "all" = "all"): string {
  const dispatch = mode === "all" ? buildBlendSwitch() : buildBlendSingle(mode);
  return `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_prev;
uniform sampler2D u_layer;
uniform sampler2D u_mask;
uniform bool u_prevValid;
uniform bool u_srcPremul;
uniform bool u_hasMask;
uniform int u_mode;
uniform float u_opacity;
uniform vec4 u_layerRect;

out vec4 outColor;

${BLEND_GLSL_HELPERS}
${dispatch}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 prev = u_prevValid ? texelFetch(u_prev, p, 0) : vec4(0.0);
  vec2 lp = vec2(p) - u_layerRect.xy;
  vec4 src = vec4(0.0);
  if (lp.x >= 0.0 && lp.y >= 0.0 && lp.x < u_layerRect.z && lp.y < u_layerRect.w) {
    src = texelFetch(u_layer, ivec2(lp), 0);
    if (u_srcPremul) src.rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
    if (u_hasMask) src.a *= texelFetch(u_mask, ivec2(lp), 0).r;
  }
  float as = src.a * u_opacity;
  float ab = prev.a;
  vec3 cb = ab > 0.0 ? prev.rgb / ab : vec3(0.0);
  vec3 cs = src.rgb;
  vec3 b = pf_blend(u_mode, cb, cs);
  float ao = as + ab * (1.0 - as);
  vec3 co = (1.0 - as) * prev.rgb + as * (1.0 - ab) * cs + as * ab * b;
  outColor = vec4(co, ao);
}
`;
}

/**
 * Final on-screen pass: checkerboard + composite (premultiplied) through the viewport
 * transform, optional pixel grid, marching ants from the binary selection texture, and
 * the neon glow outside the document (matches the scaffold's look).
 */
export const PRESENT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_composite;
uniform sampler2D u_selection;
uniform vec2 u_view;
uniform mat3 u_screenToDoc;
uniform vec2 u_docSize;
uniform float u_zoom;
uniform float u_checker;
uniform vec3 u_checkLight;
uniform vec3 u_checkDark;
uniform vec3 u_bg;
uniform vec3 u_glow;
uniform bool u_showGrid;
uniform bool u_showAnts;
uniform float u_antsPhase;

out vec4 outColor;

float selAt(vec2 d) {
  if (d.x < 0.0 || d.y < 0.0 || d.x >= u_docSize.x || d.y >= u_docSize.y) return 0.0;
  return texelFetch(u_selection, ivec2(d), 0).r;
}

vec2 toDoc(vec2 p) {
  return (u_screenToDoc * vec3(p, 1.0)).xy;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_view.y - gl_FragCoord.y);
  vec2 d = toDoc(p);
  bool inside = d.x >= 0.0 && d.y >= 0.0 && d.x < u_docSize.x && d.y < u_docSize.y;
  vec3 color;
  if (inside) {
    vec2 c = floor(p / u_checker);
    vec3 checker = mix(u_checkLight, u_checkDark, mod(c.x + c.y, 2.0));
    vec4 comp = texture(u_composite, d / u_docSize);
    color = comp.rgb + checker * (1.0 - comp.a);
    if (u_showGrid) {
      vec2 f = fract(d);
      float lw = 1.0 / u_zoom;
      if (f.x < lw || f.y < lw) color = mix(color, vec3(0.5), 0.35);
    }
  } else {
    vec2 q = max(-d, d - u_docSize);
    float dist = max(q.x, q.y) * u_zoom;
    color = u_bg + u_glow * exp(-dist / 28.0) * 0.35;
    if (dist < 1.0) color = u_glow;
  }
  if (u_showAnts) {
    float m0 = selAt(d);
    if (m0 > 0.5) {
      float mr = selAt(toDoc(p + vec2(1.0, 0.0)));
      float ml = selAt(toDoc(p - vec2(1.0, 0.0)));
      float md = selAt(toDoc(p + vec2(0.0, 1.0)));
      float mu = selAt(toDoc(p - vec2(0.0, 1.0)));
      if (min(min(mr, ml), min(md, mu)) < 0.5) {
        float dash = mod(floor((p.x + p.y + u_antsPhase) / 4.0), 2.0);
        color = dash < 1.0 ? vec3(0.0) : vec3(1.0);
      }
    }
  }
  outColor = vec4(color, 1.0);
}
`;

/** Uniform names the compositor looks up, exported for tests. */
export const BLEND_UNIFORMS = [
  "u_prev",
  "u_layer",
  "u_mask",
  "u_prevValid",
  "u_srcPremul",
  "u_hasMask",
  "u_mode",
  "u_opacity",
  "u_layerRect",
] as const;

export const PRESENT_UNIFORMS = [
  "u_composite",
  "u_selection",
  "u_view",
  "u_screenToDoc",
  "u_docSize",
  "u_zoom",
  "u_checker",
  "u_checkLight",
  "u_checkDark",
  "u_bg",
  "u_glow",
  "u_showGrid",
  "u_showAnts",
  "u_antsPhase",
] as const;
