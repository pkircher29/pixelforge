/**
 * WebGL2 checkerboard: a full-screen triangle whose fragment shader paints the
 * transparency checker inside the document rect, a hairline border and a soft neon
 * glow outside it. Pure WebGL2, no Svelte, so it stays unit-testable in principle.
 */

import type { FitRect } from "./fit";

export const CHECKER_VERT = `#version 300 es
precision highp float;
void main() {
  // Full-screen triangle from gl_VertexID; no vertex buffer needed.
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CHECKER_FRAG = `#version 300 es
precision highp float;

uniform vec2 u_viewport;  // framebuffer size in px
uniform vec4 u_rect;      // document rect: x, y, w, h (px, origin top-left)
uniform float u_cell;     // checker cell size in px
uniform vec3 u_light;
uniform vec3 u_dark;
uniform vec3 u_bg;
uniform vec3 u_glow;

out vec4 outColor;

void main() {
  // Flip to a top-left origin so the rect matches CSS/document space.
  vec2 p = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
  vec2 rel = p - u_rect.xy;

  // Signed distance to the rect edge (negative inside).
  vec2 q = max(-rel, rel - u_rect.zw);
  float d = max(q.x, q.y);

  if (d < 0.0) {
    vec2 c = floor(rel / u_cell);
    float k = mod(c.x + c.y, 2.0);
    outColor = vec4(mix(u_light, u_dark, k), 1.0);
    return;
  }

  if (d < 1.0) {
    outColor = vec4(u_glow, 1.0);
    return;
  }

  float glow = exp(-d / 28.0) * 0.35;
  outColor = vec4(u_bg + u_glow * glow, 1.0);
}
`;

export interface Checkerboard {
  /** Draw into a `w` x `h` framebuffer; `rect` is the document area in px. */
  draw(w: number, h: number, rect: FitRect, cellPx: number): void;
  /** Release GL resources. */
  dispose(): void;
}

export interface CheckerColors {
  light: [number, number, number];
  dark: [number, number, number];
  bg: [number, number, number];
  glow: [number, number, number];
}

export const DEFAULT_COLORS: CheckerColors = {
  light: [0.78, 0.8, 0.84],
  dark: [0.55, 0.57, 0.62],
  bg: [0.043, 0.051, 0.071], // --bg-0 #0b0d12
  glow: [0.486, 0.361, 1.0], // --accent #7c5cff
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2: createShader failed");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown error";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL2: createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown error";
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link failed: ${log}`);
  }
  return program;
}

export function createCheckerboard(
  gl: WebGL2RenderingContext,
  colors: CheckerColors = DEFAULT_COLORS,
): Checkerboard {
  const program = link(gl, CHECKER_VERT, CHECKER_FRAG);
  const vao = gl.createVertexArray();

  const u = {
    viewport: gl.getUniformLocation(program, "u_viewport"),
    rect: gl.getUniformLocation(program, "u_rect"),
    cell: gl.getUniformLocation(program, "u_cell"),
    light: gl.getUniformLocation(program, "u_light"),
    dark: gl.getUniformLocation(program, "u_dark"),
    bg: gl.getUniformLocation(program, "u_bg"),
    glow: gl.getUniformLocation(program, "u_glow"),
  };

  return {
    draw(w, h, rect, cellPx) {
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.viewport, w, h);
      gl.uniform4f(u.rect, rect.x, rect.y, rect.w, rect.h);
      gl.uniform1f(u.cell, Math.max(1, cellPx));
      gl.uniform3fv(u.light, colors.light);
      gl.uniform3fv(u.dark, colors.dark);
      gl.uniform3fv(u.bg, colors.bg);
      gl.uniform3fv(u.glow, colors.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
