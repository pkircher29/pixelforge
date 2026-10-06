/**
 * WebGL2 compositor.
 *
 * Resources: one RGBA8 texture per raster layer (uploaded on dirty rect only), doc-sized
 * framebuffers: `result` (the cached composite, premultiplied), two ping-pong buffers,
 * an optional "below" cache (composite of the layers under the active layer) and two
 * ping-pong buffers for groups. One fragment program blends a layer over the running
 * composite (`uniform int u_mode` switch by default; per-mode programs optional), and a
 * present program draws the result through the viewport with checkerboard, pixel grid
 * and marching ants.
 *
 * `render()` is cheap when nothing changed: it diffs layer props (O(layers)), uploads
 * only what `markDirty` reported, re-composites only the union dirty rect (scissored)
 * and only from the lowest changed top-level layer, then runs the present pass.
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import type { Selection } from "../selection";
import { BLEND_MODE_INDEX } from "../blend";
import { topLevelLayers } from "../document";
import { BlendMode, type Document, type ICompositor, type Layer, type LayerId, type RenderOptions, type RenderStats } from "../types";
import type { Viewport } from "../viewport";
import { DirtyTracker } from "./dirty";
import { thresholdMask } from "./ants";
import { createFbo, createTexture, deleteFbo, linkProgram, uniformMap, type Fbo } from "./gl";
import { BLEND_UNIFORMS, FULLSCREEN_VERT, PRESENT_FRAG, PRESENT_UNIFORMS, buildBlendFragment } from "./shaders";

export interface CompositorColors {
  light: [number, number, number];
  dark: [number, number, number];
  bg: [number, number, number];
  glow: [number, number, number];
}

/** Matches the scaffold's checkerboard palette (`--bg-0`, `--accent`). */
export const DEFAULT_COMPOSITOR_COLORS: CompositorColors = {
  light: [0.78, 0.8, 0.84],
  dark: [0.55, 0.57, 0.62],
  bg: [0.043, 0.051, 0.071],
  glow: [0.486, 0.361, 1.0],
};

export interface GlCompositorOptions {
  colors?: CompositorColors;
  /**
   * `"switch"` (default): one program with a `uniform int` mode switch (one compile, no
   * program changes between passes). `"per-mode"`: 16 specialised programs compiled
   * lazily (slightly cheaper fragments, more state changes). Both share formulas.
   */
  programs?: "switch" | "per-mode";
  /** Existing context to adopt (tests / shared canvases). */
  gl?: WebGL2RenderingContext;
}

interface LayerGpu {
  tex: WebGLTexture;
  w: number;
  h: number;
  raster: Raster;
  maskTex: WebGLTexture | null;
  mask: Raster | null;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  parentId: LayerId | null;
  docRect: Rect;
}

interface GroupCache {
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
}

interface BlendProgram {
  prog: WebGLProgram;
  u: Record<(typeof BLEND_UNIFORMS)[number], WebGLUniformLocation | null>;
}

const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
};

export class GlCompositor implements ICompositor {
  readonly kind = "webgl2" as const;
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  private readonly colors: CompositorColors;
  private readonly programMode: "switch" | "per-mode";
  private lost = false;

  private vao: WebGLVertexArrayObject | null = null;
  private blendSwitch: BlendProgram | null = null;
  private readonly blendPerMode = new Map<BlendMode, BlendProgram>();
  private currentProgram: WebGLProgram | null = null;
  private presentProg: WebGLProgram | null = null;
  private presentU: Record<(typeof PRESENT_UNIFORMS)[number], WebGLUniformLocation | null> | null = null;

  private docW = 0;
  private docH = 0;
  private result: Fbo | null = null;
  private ping: [Fbo, Fbo] | null = null;
  private below: Fbo | null = null;
  private belowIndex = -1;
  private belowValid = false;
  private groupPing: [Fbo, Fbo] | null = null;

  private readonly layers = new Map<LayerId, LayerGpu>();
  private readonly groups = new Map<LayerId, GroupCache>();
  private prevOrder: LayerId[] = [];
  private prevParents: (LayerId | null)[] = [];
  private readonly dirty = new DirtyTracker();
  private forceFullNext = true;

  private selTex: WebGLTexture | null = null;
  private selBuf: Uint8Array = new Uint8Array(0);
  private lastSelection: Selection | null = null;
  private resultFilterNearest = true;

  // Scratch (no per-frame allocation).
  private readonly mat = new Float32Array(9);
  private readonly topIndex = new Map<LayerId, number>();
  private readonly seen = new Set<LayerId>();
  private readonly stats: RenderStats = { drawn: false, recomposited: false, compositedArea: 0, passes: 0, uploads: 0 };

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.initGl();
  };

  /** True when a WebGL2 context can be created on this canvas (or a probe canvas). */
  static isSupported(canvas?: HTMLCanvasElement): boolean {
    try {
      const c = canvas ?? document.createElement("canvas");
      return !!c.getContext("webgl2", CONTEXT_ATTRS);
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, opts: GlCompositorOptions = {}) {
    this.canvas = canvas;
    this.colors = opts.colors ?? DEFAULT_COMPOSITOR_COLORS;
    this.programMode = opts.programs ?? "switch";
    const gl = opts.gl ?? canvas.getContext("webgl2", CONTEXT_ATTRS);
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.onLost, false);
    canvas.addEventListener("webglcontextrestored", this.onRestored, false);
    this.initGl();
  }

  // ------------------------------------------------------------------ lifecycle

  private initGl(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    this.blendSwitch = null;
    this.blendPerMode.clear();
    this.currentProgram = null;
    if (this.programMode === "switch") this.blendSwitch = this.makeBlendProgram("all");
    this.presentProg = linkProgram(gl, FULLSCREEN_VERT, PRESENT_FRAG);
    this.presentU = uniformMap(gl, this.presentProg, PRESENT_UNIFORMS);
    gl.useProgram(this.presentProg);
    gl.uniform1i(this.presentU.u_composite, 0);
    gl.uniform1i(this.presentU.u_selection, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    // Everything GPU-side is gone (fresh context or restored one).
    this.layers.clear();
    this.groups.clear();
    this.prevOrder = [];
    this.prevParents = [];
    this.result = null;
    this.ping = null;
    this.below = null;
    this.belowValid = false;
    this.groupPing = null;
    this.selTex = null;
    this.lastSelection = null;
    this.docW = 0;
    this.docH = 0;
    this.dirty.clear();
    this.forceFullNext = true;
  }

  private makeBlendProgram(mode: BlendMode | "all"): BlendProgram {
    const gl = this.gl;
    const prog = linkProgram(gl, FULLSCREEN_VERT, buildBlendFragment(mode));
    const u = uniformMap(gl, prog, BLEND_UNIFORMS);
    gl.useProgram(prog);
    gl.uniform1i(u.u_prev, 0);
    gl.uniform1i(u.u_layer, 1);
    gl.uniform1i(u.u_mask, 2);
    return { prog, u };
  }

  private blendProgramFor(mode: BlendMode): BlendProgram {
    if (this.blendSwitch) return this.blendSwitch;
    let p = this.blendPerMode.get(mode);
    if (!p) {
      p = this.makeBlendProgram(mode);
      this.blendPerMode.set(mode, p);
    }
    return p;
  }

  isContextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  markDirty(layerId: LayerId, rect?: Rect): void {
    this.dirty.mark(layerId, rect);
  }

  invalidateAll(): void {
    for (const id of this.layers.keys()) this.dirty.mark(id);
    this.lastSelection = null;
    this.belowValid = false;
    this.forceFullNext = true;
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const e of this.layers.values()) {
      gl.deleteTexture(e.tex);
      if (e.maskTex) gl.deleteTexture(e.maskTex);
    }
    this.layers.clear();
    this.deleteDocBuffers();
    if (this.selTex) gl.deleteTexture(this.selTex);
    this.selTex = null;
    if (this.blendSwitch) gl.deleteProgram(this.blendSwitch.prog);
    for (const p of this.blendPerMode.values()) gl.deleteProgram(p.prog);
    this.blendPerMode.clear();
    if (this.presentProg) gl.deleteProgram(this.presentProg);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.presentProg = null;
    this.vao = null;
  }

  // ------------------------------------------------------------------ buffers

  private deleteDocBuffers(): void {
    const gl = this.gl;
    deleteFbo(gl, this.result);
    if (this.ping) {
      deleteFbo(gl, this.ping[0]);
      deleteFbo(gl, this.ping[1]);
    }
    deleteFbo(gl, this.below);
    if (this.groupPing) {
      deleteFbo(gl, this.groupPing[0]);
      deleteFbo(gl, this.groupPing[1]);
    }
    this.result = null;
    this.ping = null;
    this.below = null;
    this.belowValid = false;
    this.groupPing = null;
  }

  /** (Re)create the doc-sized buffers; returns true when they were (re)allocated. */
  private ensureDocBuffers(w: number, h: number): boolean {
    if (this.result && this.docW === w && this.docH === h) return false;
    const gl = this.gl;
    this.deleteDocBuffers();
    this.docW = w;
    this.docH = h;
    this.result = createFbo(gl, w, h);
    this.ping = [createFbo(gl, w, h), createFbo(gl, w, h)];
    if (this.selTex) gl.deleteTexture(this.selTex);
    this.selBuf = new Uint8Array(w * h);
    this.selTex = createTexture(gl, w, h, gl.R8, gl.RED, this.selBuf);
    this.lastSelection = null;
    return true;
  }

  private ensureBelow(): Fbo {
    if (!this.below) this.below = createFbo(this.gl, this.docW, this.docH);
    return this.below;
  }

  private ensureGroupPing(): [Fbo, Fbo] {
    if (!this.groupPing) this.groupPing = [createFbo(this.gl, this.docW, this.docH), createFbo(this.gl, this.docW, this.docH)];
    return this.groupPing;
  }

  // ------------------------------------------------------------------ uploads

  private uploadFull(tex: WebGLTexture, raster: Raster, realloc: boolean): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (realloc) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, raster.width, raster.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, raster.data);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, raster.width, raster.height, gl.RGBA, gl.UNSIGNED_BYTE, raster.data);
    }
    this.stats.uploads++;
  }

  /** Upload only `rect` of the raster, straight from the full buffer (no copy). */
  private uploadRect(tex: WebGLTexture, raster: Raster, rect: Rect): void {
    const gl = this.gl;
    const r = Rect.intersect(rect, raster.bounds());
    if (Rect.isEmpty(r)) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, raster.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, raster.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.stats.uploads++;
  }

  private uploadSelection(sel: Selection): void {
    const gl = this.gl;
    if (!this.selTex || sel.width !== this.docW || sel.height !== this.docH) return;
    thresholdMask(sel, this.selBuf);
    gl.bindTexture(gl.TEXTURE_2D, this.selTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.docW, this.docH, gl.RED, gl.UNSIGNED_BYTE, this.selBuf);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.lastSelection = sel;
  }

  // ------------------------------------------------------------------ render

  render(doc: Document, viewport: Viewport, opts: RenderOptions = {}): RenderStats {
    const st = this.stats;
    st.drawn = false;
    st.recomposited = false;
    st.compositedArea = 0;
    st.passes = 0;
    st.uploads = 0;
    if (this.isContextLost()) return st;
    const gl = this.gl;

    const W = opts.width ?? this.canvas.width;
    const H = opts.height ?? this.canvas.height;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }

    let structural = this.ensureDocBuffers(doc.width, doc.height) || this.forceFullNext || opts.forceFull === true;
    this.forceFullNext = false;

    // ---- structure diff (order / parents)
    const layers = doc.layers;
    if (!structural) {
      if (layers.length !== this.prevOrder.length) structural = true;
      else {
        for (let i = 0; i < layers.length; i++) {
          const l = layers[i]!;
          if (l.id !== this.prevOrder[i] || l.parentId !== this.prevParents[i]) {
            structural = true;
            break;
          }
        }
      }
    }
    if (structural) {
      this.prevOrder.length = layers.length;
      this.prevParents.length = layers.length;
      for (let i = 0; i < layers.length; i++) {
        this.prevOrder[i] = layers[i]!.id;
        this.prevParents[i] = layers[i]!.parentId;
      }
      this.belowValid = false;
    }

    // ---- top-level index per layer (groups bring their children)
    const top = topLevelLayers(doc);
    this.topIndex.clear();
    for (let i = 0; i < top.length; i++) this.topIndex.set(top[i]!.id, i);
    for (const l of layers) if (l.parentId !== null) this.topIndex.set(l.id, this.topIndex.get(l.parentId) ?? 0);

    // ---- per-layer sync
    let dirtyDoc: Rect | null = structural ? Rect.ofSize(doc.width, doc.height) : null;
    let lowestTop = structural ? 0 : Infinity;
    const change = (r: Rect | null, ti: number): void => {
      if (r && !Rect.isEmpty(r)) dirtyDoc = Rect.union(dirtyDoc, r);
      if (ti < lowestTop) lowestTop = ti;
      if (ti < this.belowIndex) this.belowValid = false;
    };
    this.seen.clear();
    for (const layer of layers) {
      this.seen.add(layer.id);
      const ti = this.topIndex.get(layer.id) ?? 0;
      if (layer.kind === "group") {
        const g = this.groups.get(layer.id);
        if (!g) {
          this.groups.set(layer.id, { opacity: layer.opacity, blendMode: layer.blendMode, visible: layer.visible });
          change(Rect.ofSize(doc.width, doc.height), ti);
        } else if (g.opacity !== layer.opacity || g.blendMode !== layer.blendMode || g.visible !== layer.visible) {
          g.opacity = layer.opacity;
          g.blendMode = layer.blendMode;
          g.visible = layer.visible;
          change(Rect.ofSize(doc.width, doc.height), ti);
        }
        continue;
      }
      const raster = layer.raster;
      const docRect = Rect.make(layer.offset.x, layer.offset.y, raster.width, raster.height);
      let e = this.layers.get(layer.id);
      if (!e) {
        const tex = createTexture(gl, raster.width, raster.height, gl.RGBA8, gl.RGBA, raster.data);
        st.uploads++;
        e = {
          tex,
          w: raster.width,
          h: raster.height,
          raster,
          maskTex: null,
          mask: null,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          visible: layer.visible,
          parentId: layer.parentId,
          docRect,
        };
        this.layers.set(layer.id, e);
        this.dirty.take(layer.id);
        change(docRect, ti);
      } else {
        if (e.raster !== raster || e.w !== raster.width || e.h !== raster.height) {
          const realloc = e.w !== raster.width || e.h !== raster.height;
          this.uploadFull(e.tex, raster, realloc);
          this.dirty.take(layer.id);
          change(Rect.union(e.docRect, docRect), ti);
          e.raster = raster;
          e.w = raster.width;
          e.h = raster.height;
        } else {
          const d = this.dirty.take(layer.id);
          if (d === "full") {
            this.uploadFull(e.tex, raster, false);
            change(docRect, ti);
          } else if (d) {
            this.uploadRect(e.tex, raster, d);
            change(Rect.translate(Rect.intersect(d, raster.bounds()), layer.offset.x, layer.offset.y), ti);
          }
        }
        if (
          e.opacity !== layer.opacity ||
          e.blendMode !== layer.blendMode ||
          e.visible !== layer.visible ||
          e.parentId !== layer.parentId
        ) {
          change(Rect.union(e.docRect, docRect), ti);
        } else if (!Rect.equals(e.docRect, docRect)) {
          change(Rect.union(e.docRect, docRect), ti);
        }
        e.opacity = layer.opacity;
        e.blendMode = layer.blendMode;
        e.visible = layer.visible;
        e.parentId = layer.parentId;
        e.docRect = docRect;
      }
      // Layer mask texture.
      if (layer.mask !== e.mask) {
        if (layer.mask) {
          if (e.maskTex && e.mask && e.mask.width === layer.mask.width && e.mask.height === layer.mask.height) {
            this.uploadFull(e.maskTex, layer.mask, false);
          } else {
            if (e.maskTex) gl.deleteTexture(e.maskTex);
            e.maskTex = createTexture(gl, layer.mask.width, layer.mask.height, gl.RGBA8, gl.RGBA, layer.mask.data);
            st.uploads++;
          }
        } else if (e.maskTex) {
          gl.deleteTexture(e.maskTex);
          e.maskTex = null;
        }
        e.mask = layer.mask;
        change(docRect, ti);
      }
    }
    // Removed layers.
    for (const [id, e] of this.layers) {
      if (this.seen.has(id)) continue;
      gl.deleteTexture(e.tex);
      if (e.maskTex) gl.deleteTexture(e.maskTex);
      this.layers.delete(id);
      change(e.docRect, 0);
    }
    for (const id of this.groups.keys()) if (!this.seen.has(id)) this.groups.delete(id);
    this.dirty.retain(this.seen);

    // ---- selection
    if (doc.selection !== this.lastSelection) this.uploadSelection(doc.selection);

    // ---- composite
    if (dirtyDoc !== null) {
      const rect = Rect.intersect(dirtyDoc, Rect.ofSize(doc.width, doc.height));
      if (!Rect.isEmpty(rect)) {
        const cacheIndex = opts.activeLayerId ? (this.topIndex.get(opts.activeLayerId) ?? -1) : -1;
        this.composite(doc, top, rect, Number.isFinite(lowestTop) ? lowestTop : 0, cacheIndex);
        st.recomposited = true;
      }
    }

    // ---- present
    this.present(doc, viewport, opts, W, H);
    st.drawn = true;
    return st;
  }

  // ------------------------------------------------------------------ compositing

  private composite(doc: Document, top: readonly Layer[], rectIn: Rect, lowestTop: number, cacheIndex: number): void {
    const gl = this.gl;
    const result = this.result;
    const ping = this.ping;
    if (!result || !ping) return;
    let rect = rectIn;
    let full = rect.x === 0 && rect.y === 0 && rect.w === this.docW && rect.h === this.docH;
    let start = 0;
    let cur: Fbo | null = null;

    if (!full && this.belowValid && this.below && this.belowIndex <= lowestTop) {
      start = this.belowIndex;
      cur = this.below;
    } else if (!full && cacheIndex > 0 && top.length > 2 && (!this.belowValid || this.belowIndex !== cacheIndex)) {
      // Promote to a full composite once so the below-cache gets built for this layer.
      full = true;
      rect = Rect.ofSize(this.docW, this.docH);
      this.belowValid = false;
    }

    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.docW, this.docH);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.w, rect.h);
    this.stats.compositedArea += rect.w * rect.h;

    let pi = 0;
    for (let k = start; k < top.length; k++) {
      if (full && k === cacheIndex && k > 0) {
        const below = this.ensureBelow();
        if (cur !== below) {
          if (cur) this.blit(cur, below, rect);
          else this.clearFbo(below);
        }
        this.belowIndex = k;
        this.belowValid = true;
      }
      const layer = top[k]!;
      if (!layer.visible) continue;
      if (layer.kind === "raster") {
        const e = this.layers.get(layer.id);
        if (!e) continue;
        const target = ping[pi]!;
        this.drawBlend(target, cur, e.tex, e.docRect, layer.opacity, layer.blendMode, e.maskTex, false);
        cur = target;
        pi ^= 1;
      } else {
        const g = this.compositeGroup(doc, layer);
        if (!g) continue;
        const target = ping[pi]!;
        this.drawBlend(target, cur, g.tex, Rect.ofSize(this.docW, this.docH), layer.opacity, layer.blendMode, null, true);
        cur = target;
        pi ^= 1;
      }
    }
    if (cur) this.blit(cur, result, rect);
    else this.clearFbo(result);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Composite a group's children into the group ping-pong; returns the final buffer. */
  private compositeGroup(doc: Document, group: Layer): Fbo | null {
    const gp = this.ensureGroupPing();
    let cur: Fbo | null = null;
    let pi = 0;
    const layers = doc.layers;
    const start = layers.indexOf(group) + 1;
    for (let i = start; i < layers.length; i++) {
      const child = layers[i]!;
      if (child.parentId !== group.id) break;
      if (!child.visible || child.kind !== "raster") continue;
      const e = this.layers.get(child.id);
      if (!e) continue;
      const target = gp[pi]!;
      this.drawBlend(target, cur, e.tex, e.docRect, child.opacity, child.blendMode, e.maskTex, false);
      cur = target;
      pi ^= 1;
    }
    return cur;
  }

  private drawBlend(
    target: Fbo,
    prev: Fbo | null,
    srcTex: WebGLTexture,
    srcRect: Rect,
    opacity: number,
    mode: BlendMode,
    maskTex: WebGLTexture | null,
    srcPremul: boolean,
  ): void {
    const gl = this.gl;
    const p = this.blendProgramFor(mode);
    if (this.currentProgram !== p.prog) {
      gl.useProgram(p.prog);
      this.currentProgram = p.prog;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prev ? prev.tex : srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTex ?? srcTex);
    gl.uniform1i(p.u.u_prevValid, prev ? 1 : 0);
    gl.uniform1i(p.u.u_srcPremul, srcPremul ? 1 : 0);
    gl.uniform1i(p.u.u_hasMask, maskTex ? 1 : 0);
    gl.uniform1i(p.u.u_mode, BLEND_MODE_INDEX[mode]);
    gl.uniform1f(p.u.u_opacity, opacity);
    gl.uniform4f(p.u.u_layerRect, srcRect.x, srcRect.y, srcRect.w, srcRect.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.passes++;
  }

  private blit(src: Fbo, dst: Fbo, rect: Rect): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    gl.blitFramebuffer(rect.x, rect.y, x1, y1, rect.x, rect.y, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }

  private clearFbo(f: Fbo): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // ------------------------------------------------------------------ present

  private present(doc: Document, viewport: Viewport, opts: RenderOptions, W: number, H: number): void {
    const gl = this.gl;
    const u = this.presentU;
    if (!u || !this.presentProg || !this.result || !this.selTex) return;
    const dpr = opts.dpr ?? 1;
    const zoom = viewport.zoom * dpr;
    const c = this.colors;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.presentProg);
    this.currentProgram = this.presentProg;
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.result.tex);
    const nearest = zoom >= 1;
    if (nearest !== this.resultFilterNearest) {
      const f = nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      this.resultFilterNearest = nearest;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.selTex);

    viewport.inverseMatrix(this.mat, dpr);
    gl.uniformMatrix3fv(u.u_screenToDoc, false, this.mat);
    gl.uniform2f(u.u_view, W, H);
    gl.uniform2f(u.u_docSize, doc.width, doc.height);
    gl.uniform1f(u.u_zoom, zoom);
    gl.uniform1f(u.u_checker, Math.max(1, opts.checkerSize ?? 8));
    gl.uniform3f(u.u_checkLight, c.light[0], c.light[1], c.light[2]);
    gl.uniform3f(u.u_checkDark, c.dark[0], c.dark[1], c.dark[2]);
    gl.uniform3f(u.u_bg, c.bg[0], c.bg[1], c.bg[2]);
    gl.uniform3f(u.u_glow, c.glow[0], c.glow[1], c.glow[2]);
    const showGrid = (opts.showPixelGrid ?? true) && zoom >= (opts.pixelGridMinZoom ?? 8);
    gl.uniform1i(u.u_showGrid, showGrid ? 1 : 0);
    const showAnts = (opts.showSelection ?? true) && !doc.selection.isEmpty;
    gl.uniform1i(u.u_showAnts, showAnts ? 1 : 0);
    gl.uniform1f(u.u_antsPhase, opts.antsPhase ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------------ debugging

  /**
   * Read the cached composite back as a straight-alpha raster (slow; for tests and
   * debugging — exports should use the CPU `compositeToRaster`).
   */
  readComposite(): Raster | null {
    const gl = this.gl;
    if (!this.result) return null;
    const w = this.docW;
    const h = this.docH;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.result.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Raster(w, h);
    const d = out.data;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3]!;
      if (a === 0) continue;
      const k = 255 / a;
      d[i] = buf[i]! * k;
      d[i + 1] = buf[i + 1]! * k;
      d[i + 2] = buf[i + 2]! * k;
      d[i + 3] = a;
    }
    return out;
  }

  /** Snapshot of internal cache state for tests/stats. */
  debugState(): { layers: number; belowValid: boolean; belowIndex: number; docW: number; docH: number } {
    return { layers: this.layers.size, belowValid: this.belowValid, belowIndex: this.belowIndex, docW: this.docW, docH: this.docH };
  }
}
