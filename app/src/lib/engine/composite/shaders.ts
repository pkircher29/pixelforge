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
 * - `u_mask` optional layer mask (red channel, layer-sized), enabled by `u_hasMask`
 * - `u_clip` optional document-sized clip alpha (red channel), enabled by `u_hasClip`
 *   (clipping masks: the base's content alpha)
 * - `u_layerRect` x, y, w, h of the source in doc pixels
 * - `u_mode`, `u_opacity`
 * - `u_lerp`: pass-through group with opacity / mask — `out = mix(prev, src, opacity × mask)`
 * - `u_adjust`: adjustment layer — `src` holds the op result (straight RGB, doc-sized);
 *   the color is lerped towards `blend(prev, src)` by `opacity × mask × clip`, alpha is
 *   kept
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
uniform sampler2D u_clip;
uniform bool u_prevValid;
uniform bool u_srcPremul;
uniform bool u_hasMask;
uniform bool u_hasClip;
uniform bool u_lerp;
uniform bool u_adjust;
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
  bool inside = lp.x >= 0.0 && lp.y >= 0.0 && lp.x < u_layerRect.z && lp.y < u_layerRect.w;
  vec4 src = vec4(0.0);
  float maskV = 1.0;
  if (inside) {
    src = texelFetch(u_layer, ivec2(lp), 0);
    if (u_srcPremul) src.rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
    if (u_hasMask) maskV = texelFetch(u_mask, ivec2(lp), 0).r;
  }
  float t = u_opacity;
  if (u_hasClip) t *= texelFetch(u_clip, p, 0).r;
  if (u_lerp) {
    float k = inside ? t * maskV : 0.0;
    vec4 sp = vec4(src.rgb * src.a, src.a);
    outColor = mix(prev, sp, k);
    return;
  }
  if (u_adjust) {
    float k = inside ? t * maskV : 0.0;
    vec3 cb = prev.a > 0.0 ? prev.rgb / prev.a : vec3(0.0);
    vec3 b = pf_blend(u_mode, cb, src.rgb);
    vec3 co = mix(cb, b, k);
    outColor = vec4(co * prev.a, prev.a);
    return;
  }
  float as = src.a * maskV * t;
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
 * transform, optional pixel grid, marching ants from the binary selection texture, the
 * neon glow outside the document (matches the scaffold's look), channel view modes
 * (`u_viewMode`: 0 = RGB, 1/2/3 = R/G/B as gray, 4 = `u_channel` gray texture) and the
 * quick-mask tint (`u_qmActive`, `u_qm`, `u_qmColor`, `u_qmOpacity`, `u_qmMasked`).
 */
export const PRESENT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_composite;
uniform sampler2D u_selection;
uniform sampler2D u_channel;
uniform sampler2D u_qm;
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
uniform int u_viewMode;
uniform bool u_qmActive;
uniform vec3 u_qmColor;
uniform float u_qmOpacity;
uniform bool u_qmMasked;

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
    if (u_viewMode == 0) {
      color = comp.rgb + checker * (1.0 - comp.a);
    } else if (u_viewMode == 4) {
      color = vec3(texture(u_channel, d / u_docSize).r);
    } else {
      float v = u_viewMode == 1 ? comp.r : (u_viewMode == 2 ? comp.g : comp.b);
      color = vec3(v);
    }
    if (u_qmActive) {
      float v = texture(u_qm, d / u_docSize).r;
      float k = (u_qmMasked ? 1.0 - v : v) * u_qmOpacity;
      color = mix(color, u_qmColor, k);
    }
    if (u_showGrid) {
      vec2 f = fract(d);
      float lw = 1.0 / u_zoom;
      if (f.x < lw || f.y < lw) {
        // Contrast against the pixel underneath (a mid-grey line vanishes on mid-grey).
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(color, luma > 0.5 ? vec3(0.0) : vec3(1.0), 0.35);
      }
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
  "u_clip",
  "u_prevValid",
  "u_srcPremul",
  "u_hasMask",
  "u_hasClip",
  "u_lerp",
  "u_adjust",
  "u_mode",
  "u_opacity",
  "u_layerRect",
] as const;

export const PRESENT_UNIFORMS = [
  "u_composite",
  "u_selection",
  "u_channel",
  "u_qm",
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
  "u_viewMode",
  "u_qmActive",
  "u_qmColor",
  "u_qmOpacity",
  "u_qmMasked",
] as const;

/** Op pass that converts a premultiplied texture to straight alpha (adjustment-layer input). */
export const UNPREMUL_PASS = `vec4 pf_op(ivec2 p) { return pf_unpremul(pf_fetch(p)); }`;
