/**
 * `GpuOp`: a tiny standalone WebGL2 "image op" runner, independent of the compositor.
 *
 * Owns one hidden context (OffscreenCanvas when available). `run()` uploads a `Raster`
 * to a texture, executes one or more fragment passes (ping-pong framebuffers, optional
 * per-pass downscale), and reads the final pass back into a new `Raster`.
 *
 * Conventions mirror `GlCompositor`: GLSL ES 3.00, full-screen triangle with no vertex
 * buffer, `texelFetch` addressing, straight alpha in textures, NEAREST/CLAMP sampling.
 * Each pass's `source` defines `vec4 pf_op(ivec2 p)`; the preamble supplies:
 *
 * - `uniform sampler2D u_image`  previous pass output (or the input for pass 0)
 * - `uniform sampler2D u_source` the original input, always
 * - `uniform ivec2 u_size`       size of `u_image`
 * - `uniform ivec2 u_sourceSize` size of `u_source`
 * - `uniform ivec2 u_outSize`    size of the current render target
 * - `vec4 pf_fetch(ivec2 p)` / `pf_fetchSource(ivec2 p)` clamped texel fetches
 * - `vec4 pf_sample(vec2 uv)`  bilinear sample of `u_image` at 0..1 uv
 */

import { Raster } from "$lib/engine";
import type { GlslPass, UniformValue } from "./types";

const VERT = `#version 300 es
precision highp float;
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PREAMBLE = `#version 300 es
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

const MAIN = `
void main() {
  outColor = pf_op(ivec2(gl_FragCoord.xy));
}
`;

/** Full fragment source for a pass (exported for tests / the demo). */
export function buildFragmentSource(passSource: string): string {
  return PREAMBLE + passSource + MAIN;
}

interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class GpuOpError extends Error {}

let shared: GpuOp | null | undefined;

export class GpuOp {
  readonly gl: WebGL2RenderingContext;
  /** True when intermediate passes render to RGBA16F (needs EXT_color_buffer_float). */
  readonly floatIntermediates: boolean;
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly programs = new Map<string, Program>();
  private vao: WebGLVertexArrayObject | null = null;
  private inputTex: WebGLTexture | null = null;
  private inputW = 0;
  private inputH = 0;
  /** Slots 0/1: ping-pong intermediates; slot 2: the RGBA8 target of the final pass. */
  private targets: Target[] = [];
  private disposed = false;

  /** Shared lazily-created instance, or `null` when WebGL2 is unavailable. */
  static shared(): GpuOp | null {
    if (shared !== undefined) return shared;
    try {
      shared = new GpuOp();
    } catch {
      shared = null;
    }
    return shared;
  }

  static isAvailable(): boolean {
    return GpuOp.shared() !== null;
  }

  constructor(canvas?: OffscreenCanvas | HTMLCanvasElement) {
    const c = canvas ?? GpuOp.makeCanvas();
    const gl = c.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new GpuOpError("WebGL2 is not available");
    this.canvas = c;
    this.gl = gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.vao = gl.createVertexArray();
    // Rendering to RGBA16F needs the extension; LINEAR sampling of half floats is core in WebGL2.
    this.floatIntermediates = !!gl.getExtension("EXT_color_buffer_float");
  }

  private static makeCanvas(): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(1, 1);
    // jsdom has no WebGL and logs a loud "not implemented" on getContext: bail early.
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) throw new GpuOpError("No WebGL2 in jsdom");
    if (typeof document !== "undefined") return document.createElement("canvas");
    throw new GpuOpError("No canvas available");
  }

  get maxSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  /**
   * Run `passes` over `input`; returns a new raster of the input size. Throws
   * `GpuOpError` on compile/link failure or context loss (callers fall back to CPU).
   */
  run(input: Raster, passes: GlslPass[]): Raster {
    if (this.disposed) throw new GpuOpError("GpuOp disposed");
    const gl = this.gl;
    if (gl.isContextLost()) throw new GpuOpError("WebGL2 context lost");
    if (passes.length === 0) return input.clone();
    const w = input.width;
    const h = input.height;
    if (w === 0 || h === 0) return input.clone();
    if (w > this.maxSize || h > this.maxSize) throw new GpuOpError("Raster exceeds MAX_TEXTURE_SIZE");

    this.uploadInput(input);
    gl.bindVertexArray(this.vao);

    let prevTex = this.inputTex!;
    let prevW = w;
    let prevH = h;
    let target: Target | null = null;
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i]!;
      const last = i === passes.length - 1;
      const scale = last ? 1 : Math.max(1e-3, pass.scale ?? 1);
      const ow = last ? w : Math.max(1, Math.round(w * scale));
      const oh = last ? h : Math.max(1, Math.round(h * scale));
      target = this.acquireTarget(last ? 2 : i % 2, ow, oh);
      const program = this.program(pass.source);
      gl.useProgram(program.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, ow, oh);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
      this.setUniform(program, "u_image", Int32Array.of(0));
      this.setUniform(program, "u_source", Int32Array.of(1));
      this.setUniform(program, "u_size", Int32Array.of(prevW, prevH));
      this.setUniform(program, "u_sourceSize", Int32Array.of(w, h));
      this.setUniform(program, "u_outSize", Int32Array.of(ow, oh));
      for (const [name, value] of Object.entries(pass.uniforms ?? {})) this.setUniform(program, name, value);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      prevTex = target.tex;
      prevW = ow;
      prevH = oh;
    }

    const out = new Raster(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target!.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out.data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new GpuOpError(`WebGL error 0x${err.toString(16)}`);
    return out;
  }

  /** Compile a pass without running it (used by the demo to surface shader errors early). */
  compile(source: string): void {
    this.program(source);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.programs.clear();
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.targets = [];
    if (this.inputTex) gl.deleteTexture(this.inputTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (shared === this) shared = undefined;
    void this.canvas;
  }

  // ------------------------------------------------------------------ internals

  private uploadInput(input: Raster): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.inputTex) {
      this.inputTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    }
    if (this.inputW === input.width && this.inputH === input.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, input.width, input.height, gl.RGBA, gl.UNSIGNED_BYTE, input.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, input.width, input.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, input.data);
      this.inputW = input.width;
      this.inputH = input.height;
    }
  }

  private acquireTarget(slot: number, w: number, h: number): Target {
    const gl = this.gl;
    const t = this.targets[slot];
    if (t && t.w === w && t.h === h) return t;
    if (t) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    const tex = gl.createTexture();
    if (!tex) throw new GpuOpError("createTexture failed");
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (slot === 2 || !this.floatIntermediates) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    }
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new GpuOpError("createFramebuffer failed");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      throw new GpuOpError(`framebuffer incomplete (0x${status.toString(16)})`);
    }
    const target: Target = { fbo, tex, w, h };
    this.targets[slot] = target;
    return target;
  }

  private program(source: string): Program {
    const cached = this.programs.get(source);
    if (cached) return cached;
    const gl = this.gl;
    const full = buildFragmentSource(source);
    const vs = this.shader(gl.VERTEX_SHADER, VERT);
    const fs = this.shader(gl.FRAGMENT_SHADER, full);
    const prog = gl.createProgram();
    if (!prog) throw new GpuOpError("createProgram failed");
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(prog) ?? "unknown";
      gl.deleteProgram(prog);
      throw new GpuOpError(`program link failed: ${log}`);
    }
    const p: Program = { prog, uniforms: new Map() };
    this.programs.set(source, p);
    return p;
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new GpuOpError("createShader failed");
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh) ?? "unknown";
      gl.deleteShader(sh);
      throw new GpuOpError(`shader compile failed: ${log}`);
    }
    return sh;
  }

  private location(p: Program, name: string): WebGLUniformLocation | null {
    if (p.uniforms.has(name)) return p.uniforms.get(name) ?? null;
    const loc = this.gl.getUniformLocation(p.prog, name);
    p.uniforms.set(name, loc);
    return loc;
  }

  /**
   * Uniform typing convention: `boolean` -> `bool`, `number` -> `float`, `number[]` of
   * length 2/3/4 -> `vecN` (else `float[]`), `Float32Array` -> `float[]`, `Int32Array` of
   * length 1 -> `int`/`sampler`, 2/3/4 -> `ivecN`, else `int[]`.
   */
  private setUniform(p: Program, name: string, value: UniformValue): void {
    const loc = this.location(p, name);
    if (!loc) return;
    const gl = this.gl;
    if (typeof value === "boolean") {
      gl.uniform1i(loc, value ? 1 : 0);
      return;
    }
    if (typeof value === "number") {
      gl.uniform1f(loc, value);
      return;
    }
    if (value instanceof Int32Array) {
      if (value.length === 1) gl.uniform1i(loc, value[0]!);
      else if (value.length === 2) gl.uniform2iv(loc, value);
      else if (value.length === 3) gl.uniform3iv(loc, value);
      else if (value.length === 4) gl.uniform4iv(loc, value);
      else gl.uniform1iv(loc, value);
      return;
    }
    if (value instanceof Float32Array) {
      gl.uniform1fv(loc, value);
      return;
    }
    const arr = new Float32Array(value);
    switch (arr.length) {
      case 2:
        gl.uniform2fv(loc, arr);
        break;
      case 3:
        gl.uniform3fv(loc, arr);
        break;
      case 4:
        gl.uniform4fv(loc, arr);
        break;
      default:
        gl.uniform1fv(loc, arr);
    }
  }
}
