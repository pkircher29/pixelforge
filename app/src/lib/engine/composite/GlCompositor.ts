/**
 * WebGL2 compositor (v2: masks, clipping masks, adjustment / fill / shape / text
 * layers, pass-through groups, fill opacity, layer styles, channel views, quick mask).
 *
 * Resources: one RGBA8 texture per non-group layer holding its *source* (the layer's
 * raster, a fill layer's render, or — for layers with effects — the CPU-styled raster
 * from `StyleCache`), an optional mask texture, an optional R8 clip texture for
 * clipping-mask bases; doc-sized framebuffers: `result` (the cached composite,
 * premultiplied), two ping-pong buffers, an optional "below" cache (composite of the
 * units under the active layer), ping-pong pairs for isolated groups and clipping units,
 * and three buffers for adjustment-layer op passes. One fragment program blends a layer
 * over the running composite (`uniform int u_mode` switch; per-mode programs optional),
 * op programs run the registry ops' GLSL for adjustment layers, and a present program
 * draws the result through the viewport with checkerboard, pixel grid, ants, channel
 * view and quick-mask tint.
 *
 * GPU vs CPU: blending, masks, clipping, pass-through / isolated groups, fill opacity
 * and adjustment ops (when the op has GLSL without down-scaled passes) run on the GPU.
 * **Layer styles (all eight effects) and fill / shape / text sources are rendered on
 * the CPU** (`ops/effects.ts`, `ops/fill.ts`, `ops/vector.ts`, `ops/text.ts`) into a
 * raster that is cached per layer (`StyleCache`) and uploaded as the layer's texture;
 * the cache is invalidated by `markDirty` on that layer or by any change of its
 * raster / mask / effects / fill opacity. Adjustment ops without usable GLSL fall back
 * to a CPU read-back → op → upload per composite.
 *
 * `render()` is cheap when nothing changed: it diffs layer props (O(layers)), uploads
 * only what `markDirty` reported, re-composites only the union dirty rect (scissored)
 * and only from the lowest changed top-level unit, then runs the present pass.
 *
 * `markDirty` accepts the pseudo ids `"@quickmask"` and `"@channel:<id>"` for channel
 * rasters painted in place.
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import type { Selection } from "../selection";
import { BLEND_MODE_INDEX } from "../blend";
import { topLevelLayers, childrenOf } from "../document";
import { StyleCache, layerVisualRect, maskActive } from "../layer-source";
import { opById } from "../ops/registry";
import { buildOpFragmentSource } from "../ops/glsl";
import type { GlslPass, UniformValue } from "../ops/types";
import { parseViewChannel } from "../channels";
import { BlendMode, type AdjustmentLayer, type Document, type ICompositor, type Layer, type LayerId, type RenderOptions, type RenderStats } from "../types";
import type { Viewport } from "../viewport";
import { DirtyTracker } from "./dirty";
import { thresholdMask } from "./ants";
import { createFbo, createTexture, deleteFbo, linkProgram, uniformMap, type Fbo } from "./gl";
import { BLEND_UNIFORMS, FULLSCREEN_VERT, PRESENT_FRAG, PRESENT_UNIFORMS, UNPREMUL_PASS, buildBlendFragment } from "./shaders";

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
  /** The raster currently uploaded (own raster, fill render or styled raster). */
  uploaded: Raster;
  /** True when `uploaded` is a styled raster (mask + effects baked in). */
  styled: boolean;
  maskTex: WebGLTexture | null;
  mask: Raster | null;
  clipTex: WebGLTexture | null;
  clipAlpha: Uint8Array | null;
  /** Prop fingerprint for change detection. */
  props: string;
  docRect: Rect;
  /** Source raster object the layer exposed last frame (identity). */
  srcRaster: Raster | null;
}

interface GroupCache {
  props: string;
}

interface BlendProgram {
  prog: WebGLProgram;
  u: Record<(typeof BLEND_UNIFORMS)[number], WebGLUniformLocation | null>;
}

interface OpProgram {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

/** A top-level compositing step: a layer (or group) plus its clipped layers. */
interface Unit {
  layer: Layer;
  chain: Layer[];
}

/** A running ping-pong chain. */
interface Chain {
  ping: [Fbo, Fbo];
  cur: Fbo | null;
  pi: number;
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

const QUICK_MASK_ID = "@quickmask";

function layerProps(l: Layer): string {
  let s = `${l.opacity}|${l.fillOpacity}|${l.blendMode}|${l.visible ? 1 : 0}|${l.parentId ?? ""}|${l.clipToBelow ? 1 : 0}|${l.maskEnabled ? 1 : 0}|${l.offset.x},${l.offset.y}`;
  if (l.effects) s += `|fx:${JSON.stringify(l.effects)}`;
  if (l.kind === "adjustment") s += `|adj:${l.op}:${JSON.stringify(l.params)}`;
  if (l.kind === "group") s += `|pt:${l.passThrough ? 1 : 0}`;
  return s;
}

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
  private readonly opPrograms = new Map<string, OpProgram>();
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
  private unitPing: [Fbo, Fbo] | null = null;
  private adjBufs: [Fbo, Fbo, Fbo] | null = null;
  private adjCpuTex: WebGLTexture | null = null;

  private readonly layers = new Map<LayerId, LayerGpu>();
  private readonly groups = new Map<LayerId, GroupCache>();
  private readonly styles = new StyleCache();
  private prevOrder: LayerId[] = [];
  private prevParents: (LayerId | null)[] = [];
  private readonly dirty = new DirtyTracker();
  private forceFullNext = true;

  private selTex: WebGLTexture | null = null;
  private selBuf: Uint8Array = new Uint8Array(0);
  private lastSelection: Selection | null = null;
  private resultFilterNearest = true;

  private channelTex: WebGLTexture | null = null;
  private channelRaster: Raster | null = null;
  private channelKey = "";
  private qmTex: WebGLTexture | null = null;
  private qmRaster: Raster | null = null;
  private qmDirty = true;
  private readonly channelDirty = new Set<string>();

  // Scratch (no per-frame allocation).
  private readonly mat = new Float32Array(9);
  private readonly topIndex = new Map<LayerId, number>();
  private readonly seen = new Set<LayerId>();
  private readonly stats: RenderStats = { drawn: false, recomposited: false, compositedArea: 0, passes: 0, uploads: 0 };
  /** Set while compositing an adjustment layer on the CPU fallback (for stats/tests). */
  private cpuAdjustments = 0;

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
    this.opPrograms.clear();
    this.currentProgram = null;
    if (this.programMode === "switch") this.blendSwitch = this.makeBlendProgram("all");
    this.presentProg = linkProgram(gl, FULLSCREEN_VERT, PRESENT_FRAG);
    this.presentU = uniformMap(gl, this.presentProg, PRESENT_UNIFORMS);
    gl.useProgram(this.presentProg);
    gl.uniform1i(this.presentU.u_composite, 0);
    gl.uniform1i(this.presentU.u_selection, 1);
    gl.uniform1i(this.presentU.u_channel, 2);
    gl.uniform1i(this.presentU.u_qm, 3);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    // Everything GPU-side is gone (fresh context or restored one).
    this.layers.clear();
    this.groups.clear();
    this.styles.clear();
    this.prevOrder = [];
    this.prevParents = [];
    this.result = null;
    this.ping = null;
    this.below = null;
    this.belowValid = false;
    this.groupPing = null;
    this.unitPing = null;
    this.adjBufs = null;
    this.adjCpuTex = null;
    this.selTex = null;
    this.lastSelection = null;
    this.channelTex = null;
    this.channelRaster = null;
    this.channelKey = "";
    this.qmTex = null;
    this.qmRaster = null;
    this.qmDirty = true;
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
    gl.uniform1i(u.u_clip, 3);
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
    if (layerId === QUICK_MASK_ID) {
      this.qmDirty = true;
      return;
    }
    if (layerId.startsWith("@channel:")) {
      this.channelDirty.add(layerId.slice(9));
      return;
    }
    this.dirty.mark(layerId, rect);
    this.styles.invalidate(layerId);
  }

  invalidateAll(): void {
    for (const id of this.layers.keys()) this.dirty.mark(id);
    this.styles.clear();
    this.lastSelection = null;
    this.belowValid = false;
    this.forceFullNext = true;
    this.qmDirty = true;
    this.channelKey = "";
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const e of this.layers.values()) this.deleteLayerGpu(e);
    this.layers.clear();
    this.deleteDocBuffers();
    if (this.selTex) gl.deleteTexture(this.selTex);
    this.selTex = null;
    if (this.channelTex) gl.deleteTexture(this.channelTex);
    this.channelTex = null;
    if (this.qmTex) gl.deleteTexture(this.qmTex);
    this.qmTex = null;
    if (this.blendSwitch) gl.deleteProgram(this.blendSwitch.prog);
    for (const p of this.blendPerMode.values()) gl.deleteProgram(p.prog);
    this.blendPerMode.clear();
    for (const p of this.opPrograms.values()) gl.deleteProgram(p.prog);
    this.opPrograms.clear();
    if (this.presentProg) gl.deleteProgram(this.presentProg);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.presentProg = null;
    this.vao = null;
  }

  private deleteLayerGpu(e: LayerGpu): void {
    const gl = this.gl;
    gl.deleteTexture(e.tex);
    if (e.maskTex) gl.deleteTexture(e.maskTex);
    if (e.clipTex) gl.deleteTexture(e.clipTex);
  }

  // ------------------------------------------------------------------ buffers

  private deleteDocBuffers(): void {
    const gl = this.gl;
    deleteFbo(gl, this.result);
    for (const pair of [this.ping, this.groupPing, this.unitPing]) {
      if (pair) {
        deleteFbo(gl, pair[0]);
        deleteFbo(gl, pair[1]);
      }
    }
    deleteFbo(gl, this.below);
    if (this.adjBufs) for (const f of this.adjBufs) deleteFbo(gl, f);
    if (this.adjCpuTex) gl.deleteTexture(this.adjCpuTex);
    this.result = null;
    this.ping = null;
    this.below = null;
    this.belowValid = false;
    this.groupPing = null;
    this.unitPing = null;
    this.adjBufs = null;
    this.adjCpuTex = null;
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
    if (this.channelTex) gl.deleteTexture(this.channelTex);
    this.channelTex = null;
    this.channelKey = "";
    if (this.qmTex) gl.deleteTexture(this.qmTex);
    this.qmTex = null;
    this.qmDirty = true;
    return true;
  }

  private ensureBelow(): Fbo {
    if (!this.below) this.below = createFbo(this.gl, this.docW, this.docH);
    return this.below;
  }

  private ensurePair(which: "group" | "unit"): [Fbo, Fbo] {
    const cur = which === "group" ? this.groupPing : this.unitPing;
    if (cur) return cur;
    const pair: [Fbo, Fbo] = [createFbo(this.gl, this.docW, this.docH), createFbo(this.gl, this.docW, this.docH)];
    if (which === "group") this.groupPing = pair;
    else this.unitPing = pair;
    return pair;
  }

  private ensureAdjBufs(): [Fbo, Fbo, Fbo] {
    if (!this.adjBufs) this.adjBufs = [createFbo(this.gl, this.docW, this.docH), createFbo(this.gl, this.docW, this.docH), createFbo(this.gl, this.docW, this.docH)];
    return this.adjBufs;
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

  private uploadR8(tex: WebGLTexture, data: Uint8Array, w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
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

  /** Red channel of a doc-sized RGBA raster as a packed R8 buffer. */
  private static redOf(r: Raster): Uint8Array {
    const out = new Uint8Array(r.width * r.height);
    const d = r.data;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = d[p]!;
    return out;
  }

  // ------------------------------------------------------------------ render

  render(doc: Document, viewport: Viewport, opts: RenderOptions = {}): RenderStats {
    const st = this.stats;
    st.drawn = false;
    st.recomposited = false;
    st.compositedArea = 0;
    st.passes = 0;
    st.uploads = 0;
    this.cpuAdjustments = 0;
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

    // ---- top-level units (groups bring their children, bases bring their clip chain)
    const units = buildUnits(topLevelLayers(doc));
    this.topIndex.clear();
    units.forEach((u, i) => {
      this.topIndex.set(u.layer.id, i);
      for (const c of u.chain) this.topIndex.set(c.id, i);
    });
    for (const l of layers) if (l.parentId !== null) this.topIndex.set(l.id, this.topIndex.get(l.parentId) ?? 0);

    // ---- per-layer sync
    let dirtyDoc: Rect | null = structural ? Rect.ofSize(doc.width, doc.height) : null;
    let lowestTop = structural ? 0 : Infinity;
    const change = (r: Rect | null, ti: number): void => {
      if (r && !Rect.isEmpty(r)) dirtyDoc = Rect.union(dirtyDoc, r);
      if (ti < lowestTop) lowestTop = ti;
      if (ti < this.belowIndex) this.belowValid = false;
    };
    const full = Rect.ofSize(doc.width, doc.height);
    // A clipped child or a child of a non-pass-through group with special props dirties
    // its base/group fully; keep it simple: any change inside a clip chain → base rect.
    this.seen.clear();
    for (const layer of layers) {
      this.seen.add(layer.id);
      const ti = this.topIndex.get(layer.id) ?? 0;
      const props = layerProps(layer);
      if (layer.kind === "group") {
        const g = this.groups.get(layer.id);
        if (!g) {
          this.groups.set(layer.id, { props });
          change(full, ti);
        } else if (g.props !== props) {
          g.props = props;
          change(full, ti);
        }
        // A group's mask is applied at composite time from the CPU raster → treat as a
        // layer texture only when needed (handled in compositeGroup via lerp/blend).
        if (layer.mask !== (this.layers.get(layer.id)?.mask ?? null) || this.dirty.peek(layer.id) !== undefined) {
          this.dirty.take(layer.id);
          this.syncMask(layer, this.ensureGroupEntry(layer));
          change(full, ti);
        }
        continue;
      }
      const isAdj = layer.kind === "adjustment";
      let e = this.layers.get(layer.id);
      const dirtyRegion = this.dirty.take(layer.id);
      if (dirtyRegion !== undefined) this.styles.invalidate(layer.id);
      const src = isAdj ? null : this.styles.styledSource(doc, layer);
      const docRect = isAdj ? full : layerVisualRect(doc, layer);
      if (!e) {
        const uploaded = src ? src.raster : new Raster(1, 1);
        const tex = createTexture(gl, uploaded.width, uploaded.height, gl.RGBA8, gl.RGBA, uploaded.data);
        st.uploads++;
        e = {
          tex,
          w: uploaded.width,
          h: uploaded.height,
          uploaded,
          styled: src?.styled ?? false,
          maskTex: null,
          mask: null,
          clipTex: null,
          clipAlpha: null,
          props,
          docRect,
          srcRaster: layer.raster,
        };
        this.layers.set(layer.id, e);
        change(isAdj ? full : docRect, ti);
      } else {
        let changed = false;
        if (src) {
          if (src.raster !== e.uploaded || e.w !== src.raster.width || e.h !== src.raster.height) {
            const realloc = e.w !== src.raster.width || e.h !== src.raster.height;
            this.uploadFull(e.tex, src.raster, realloc);
            e.uploaded = src.raster;
            e.w = src.raster.width;
            e.h = src.raster.height;
            changed = true;
          } else if (dirtyRegion === "full") {
            this.uploadFull(e.tex, src.raster, false);
            changed = true;
          } else if (dirtyRegion) {
            if (src.styled) this.uploadFull(e.tex, src.raster, false);
            else this.uploadRect(e.tex, src.raster, dirtyRegion);
            change(src.styled ? Rect.union(e.docRect, docRect) : Rect.translate(Rect.intersect(dirtyRegion, src.raster.bounds()), src.offset.x, src.offset.y), ti);
          }
          e.styled = src.styled;
        } else if (dirtyRegion !== undefined) {
          changed = true;
        }
        if (e.props !== props || !Rect.equals(e.docRect, docRect) || e.srcRaster !== layer.raster) changed = true;
        if (changed) change(isAdj ? full : Rect.union(e.docRect, docRect), ti);
        e.props = props;
        e.docRect = docRect;
        e.srcRaster = layer.raster;
      }
      // Layer mask texture (only needed when the source is not already styled).
      if (!e.styled && maskActive(layer)) {
        if (layer.mask !== e.mask || dirtyRegion !== undefined) {
          this.syncMask(layer, e);
          change(docRect, ti);
        }
      } else if (e.maskTex) {
        gl.deleteTexture(e.maskTex);
        e.maskTex = null;
        e.mask = null;
        change(docRect, ti);
      } else {
        e.mask = null;
      }
      // Clip alpha texture for clipping-mask bases.
      const unit = units[ti];
      const isBase = unit !== undefined && unit.layer.id === layer.id && unit.chain.length > 0;
      const inGroupBase = !isBase && layer.parentId !== null && hasClippedAbove(doc, layer);
      if ((isBase || inGroupBase) && layer.kind !== "adjustment") {
        const alpha = this.styles.clipAlpha(doc, layer);
        if (alpha !== e.clipAlpha) {
          if (!e.clipTex) e.clipTex = createTexture(gl, doc.width, doc.height, gl.R8, gl.RED, alpha);
          else this.uploadR8(e.clipTex, alpha, doc.width, doc.height);
          st.uploads++;
          e.clipAlpha = alpha;
          change(full, ti);
        }
      } else if (e.clipTex) {
        gl.deleteTexture(e.clipTex);
        e.clipTex = null;
        e.clipAlpha = null;
      }
    }
    // Removed layers.
    for (const [id, e] of this.layers) {
      if (this.seen.has(id)) continue;
      this.deleteLayerGpu(e);
      this.layers.delete(id);
      change(e.docRect, 0);
    }
    for (const id of this.groups.keys()) if (!this.seen.has(id)) this.groups.delete(id);
    this.dirty.retain(this.seen);
    this.styles.retain(this.seen);

    // ---- selection
    if (doc.selection !== this.lastSelection) this.uploadSelection(doc.selection);

    // ---- composite
    if (dirtyDoc !== null) {
      const rect = Rect.intersect(dirtyDoc, Rect.ofSize(doc.width, doc.height));
      if (!Rect.isEmpty(rect)) {
        const cacheIndex = opts.activeLayerId ? (this.topIndex.get(opts.activeLayerId) ?? -1) : -1;
        this.composite(doc, units, rect, Number.isFinite(lowestTop) ? lowestTop : 0, cacheIndex);
        st.recomposited = true;
      }
    }

    // ---- channel view / quick mask textures
    this.syncChannelView(doc, opts);

    // ---- present
    this.present(doc, viewport, opts, W, H);
    st.drawn = true;
    return st;
  }

  private ensureGroupEntry(group: Layer): LayerGpu {
    let e = this.layers.get(group.id);
    if (!e) {
      const gl = this.gl;
      const placeholder = new Raster(1, 1);
      e = {
        tex: createTexture(gl, 1, 1, gl.RGBA8, gl.RGBA, placeholder.data),
        w: 1,
        h: 1,
        uploaded: placeholder,
        styled: false,
        maskTex: null,
        mask: null,
        clipTex: null,
        clipAlpha: null,
        props: "",
        docRect: Rect.ofSize(this.docW, this.docH),
        srcRaster: null,
      };
      this.layers.set(group.id, e);
    }
    return e;
  }

  private syncMask(layer: Layer, e: LayerGpu): void {
    const gl = this.gl;
    if (layer.mask) {
      if (e.maskTex && e.mask && e.mask.width === layer.mask.width && e.mask.height === layer.mask.height) {
        this.uploadFull(e.maskTex, layer.mask, false);
      } else {
        if (e.maskTex) gl.deleteTexture(e.maskTex);
        e.maskTex = createTexture(gl, layer.mask.width, layer.mask.height, gl.RGBA8, gl.RGBA, layer.mask.data);
        this.stats.uploads++;
      }
    } else if (e.maskTex) {
      gl.deleteTexture(e.maskTex);
      e.maskTex = null;
    }
    e.mask = layer.mask;
  }

  private syncChannelView(doc: Document, opts: RenderOptions): void {
    const gl = this.gl;
    const view = opts.viewChannel ?? "rgb";
    const parsed = parseViewChannel(view);
    let raster: Raster | null = null;
    let key = "";
    if (parsed.kind === "alpha") {
      raster = doc.alphaChannels.find((c) => c.id === parsed.id)?.mask ?? null;
      key = `alpha:${parsed.id}`;
      if (this.channelDirty.has(parsed.id)) {
        this.channelKey = "";
        this.channelDirty.delete(parsed.id);
      }
    } else if (parsed.kind === "mask") {
      const l = opts.activeLayerId ? doc.layers.find((x) => x.id === opts.activeLayerId) : undefined;
      raster = l?.mask ?? null;
      key = `mask:${l?.id ?? ""}`;
    }
    if (raster && (raster.width !== doc.width || raster.height !== doc.height)) raster = null;
    if (raster && (raster !== this.channelRaster || key !== this.channelKey)) {
      const data = GlCompositor.redOf(raster);
      if (!this.channelTex) this.channelTex = createTexture(gl, doc.width, doc.height, gl.R8, gl.RED, data);
      else this.uploadR8(this.channelTex, data, doc.width, doc.height);
      this.stats.uploads++;
      this.channelRaster = raster;
      this.channelKey = key;
    }
    const qm = doc.quickMask;
    if ((opts.showQuickMask ?? true) && qm.active && qm.raster && qm.raster.width === doc.width && qm.raster.height === doc.height) {
      if (qm.raster !== this.qmRaster || this.qmDirty) {
        const data = GlCompositor.redOf(qm.raster);
        if (!this.qmTex) this.qmTex = createTexture(gl, doc.width, doc.height, gl.R8, gl.RED, data);
        else this.uploadR8(this.qmTex, data, doc.width, doc.height);
        this.stats.uploads++;
        this.qmRaster = qm.raster;
        this.qmDirty = false;
      }
    }
  }

  // ------------------------------------------------------------------ compositing

  private composite(doc: Document, units: readonly Unit[], rectIn: Rect, lowestTop: number, cacheIndex: number): void {
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
    } else if (!full && cacheIndex > 0 && units.length > 2 && (!this.belowValid || this.belowIndex !== cacheIndex)) {
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

    const chain: Chain = { ping, cur, pi: 0 };
    for (let k = start; k < units.length; k++) {
      if (full && k === cacheIndex && k > 0) {
        const below = this.ensureBelow();
        if (chain.cur !== below) {
          if (chain.cur) this.blit(chain.cur, below, rect);
          else this.clearFbo(below);
        }
        this.belowIndex = k;
        this.belowValid = true;
      }
      this.drawUnit(doc, chain, units[k]!, rect);
    }
    if (chain.cur) this.blit(chain.cur, result, rect);
    else this.clearFbo(result);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Draw a unit (layer / group / base + clipped chain) onto a running chain. */
  private drawUnit(doc: Document, chain: Chain, unit: Unit, rect: Rect): void {
    const layer = unit.layer;
    if (!layer.visible) return;
    if (layer.kind === "group") {
      this.drawGroup(doc, chain, layer, rect);
      return;
    }
    const visibleChain = unit.chain.filter((c) => c.visible);
    if (visibleChain.length === 0 || layer.kind === "adjustment") {
      this.drawLayer(chain, layer, null, rect);
      if (layer.kind === "adjustment") for (const c of visibleChain) this.drawLayer(chain, c, null, rect);
      return;
    }
    // Clipping unit: base at full opacity / Normal, children clipped, then the unit blends.
    const sub: Chain = { ping: this.ensurePair("unit"), cur: null, pi: 0 };
    this.drawLayer(sub, layer, null, rect, 1, BlendMode.Normal);
    const base = this.layers.get(layer.id);
    const clipTex = base?.clipTex ?? null;
    for (const c of visibleChain) this.drawLayer(sub, c, clipTex, rect);
    if (sub.cur) this.drawBlend(chain, sub.cur.tex, Rect.ofSize(this.docW, this.docH), layer.opacity, layer.blendMode, null, null, true, "normal");
  }

  private drawGroup(doc: Document, chain: Chain, group: Layer & { kind: "group" }, rect: Rect): void {
    const children = childrenOf(doc, group.id);
    if (children.length === 0) return;
    const units = buildUnits(children);
    const g = this.layers.get(group.id);
    const maskTex = maskActive(group) && g?.maskTex ? g.maskTex : null;
    if (group.passThrough) {
      if (group.opacity >= 1 && !maskTex) {
        for (const u of units) this.drawUnit(doc, chain, u, rect);
        return;
      }
      // Children composite over a copy of the backdrop; the result lerps back by opacity × mask.
      const pair = this.ensurePair("group");
      const sub: Chain = { ping: pair, cur: null, pi: 0 };
      if (chain.cur) {
        this.blit(chain.cur, pair[0]!, rect);
        sub.cur = pair[0]!;
        sub.pi = 1;
      }
      for (const u of units) this.drawUnit(doc, sub, u, rect);
      const src = sub.cur;
      if (!src) return;
      this.drawBlend(chain, src.tex, Rect.ofSize(this.docW, this.docH), group.opacity, BlendMode.Normal, maskTex, null, true, "lerp");
      return;
    }
    const sub: Chain = { ping: this.ensurePair("group"), cur: null, pi: 0 };
    for (const u of units) this.drawUnit(doc, sub, u, rect);
    if (sub.cur) this.drawBlend(chain, sub.cur.tex, Rect.ofSize(this.docW, this.docH), group.opacity, group.blendMode, maskTex, null, true, "normal");
  }

  /** Draw one non-group layer onto a chain (mask / fill opacity / clip applied). */
  private drawLayer(chain: Chain, layer: Layer, clipTex: WebGLTexture | null, rect: Rect, opacityOverride?: number, modeOverride?: BlendMode): void {
    const opacity = opacityOverride ?? layer.opacity;
    const mode = modeOverride ?? layer.blendMode;
    if (layer.kind === "adjustment") {
      this.drawAdjustment(chain, layer, clipTex, rect, opacity, mode);
      return;
    }
    const e = this.layers.get(layer.id);
    if (!e) return;
    const maskTex = !e.styled && maskActive(layer) ? e.maskTex : null;
    const op = e.styled ? opacity : opacity * layer.fillOpacity;
    this.drawBlend(chain, e.tex, e.docRect, op, mode, maskTex, clipTex, false, "normal");
  }

  /** Adjustment layer: op passes over the chain's current buffer, then the adjust-blend pass. */
  private drawAdjustment(chain: Chain, layer: AdjustmentLayer, clipTex: WebGLTexture | null, rect: Rect, opacity: number, mode: BlendMode): void {
    const gl = this.gl;
    const e = this.layers.get(layer.id);
    const def = opById(layer.op);
    if (!def || opacity <= 0) return;
    const prev = chain.cur;
    if (!prev) return; // nothing below → nothing to adjust
    const bufs = this.ensureAdjBufs();
    let resultTex: WebGLTexture | null = null;
    // Ops run over the whole buffer (ops may need margin pixels); scissor is restored after.
    gl.disable(gl.SCISSOR_TEST);
    let passes: GlslPass[] | null = null;
    try {
      passes = def.glsl(layer.params);
      if (passes.some((p) => p.scale !== undefined && p.scale !== 1)) passes = null;
    } catch {
      passes = null;
    }
    if (passes) {
      try {
        // 1. unpremultiply prev → bufs[0]
        this.runOpPass(UNPREMUL_PASS, {}, prev.tex, prev.tex, bufs[0]);
        // 2. op passes ping-pong over bufs[1]/bufs[2], u_source = bufs[0]
        let inTex = bufs[0].tex;
        let outIdx = 1;
        for (const pass of passes) {
          const target = bufs[outIdx as 1 | 2];
          this.runOpPass(pass.source, pass.uniforms ?? {}, inTex, bufs[0].tex, target);
          inTex = target.tex;
          outIdx = outIdx === 1 ? 2 : 1;
        }
        resultTex = inTex;
      } catch (err) {
        console.warn(`[pixelforge] adjustment "${layer.op}" GLSL failed, using CPU:`, err);
        resultTex = null;
      }
    }
    if (!resultTex) {
      // CPU fallback: read back, run the op, upload.
      this.cpuAdjustments++;
      const w = this.docW;
      const h = this.docH;
      const buf = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const straight = new Raster(w, h);
      const d = straight.data;
      for (let i = 0; i < buf.length; i += 4) {
        const a = buf[i + 3]!;
        if (a === 0) continue;
        const k = 255 / a;
        d[i] = buf[i]! * k;
        d[i + 1] = buf[i + 1]! * k;
        d[i + 2] = buf[i + 2]! * k;
        d[i + 3] = a;
      }
      const res = def.cpu(straight, layer.params);
      if (!this.adjCpuTex) this.adjCpuTex = createTexture(gl, w, h, gl.RGBA8, gl.RGBA, res.data);
      else this.uploadFull(this.adjCpuTex, res, false);
      this.stats.uploads++;
      resultTex = this.adjCpuTex;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.w, rect.h);
    gl.viewport(0, 0, this.docW, this.docH);
    const maskTex = maskActive(layer) && e?.maskTex && e.mask && e.mask.width === this.docW && e.mask.height === this.docH ? e.maskTex : null;
    this.drawBlend(chain, resultTex, Rect.ofSize(this.docW, this.docH), opacity, mode, maskTex, clipTex, false, "adjust");
  }

  private opProgram(source: string): OpProgram {
    const cached = this.opPrograms.get(source);
    if (cached) return cached;
    const prog = linkProgram(this.gl, FULLSCREEN_VERT, buildOpFragmentSource(source));
    const p: OpProgram = { prog, uniforms: new Map() };
    this.opPrograms.set(source, p);
    return p;
  }

  private opUniform(p: OpProgram, name: string, value: UniformValue): void {
    const gl = this.gl;
    let loc = p.uniforms.get(name);
    if (loc === undefined) {
      loc = gl.getUniformLocation(p.prog, name);
      p.uniforms.set(name, loc);
    }
    if (!loc) return;
    if (typeof value === "boolean") gl.uniform1i(loc, value ? 1 : 0);
    else if (typeof value === "number") gl.uniform1f(loc, value);
    else if (value instanceof Int32Array) {
      if (value.length === 1) gl.uniform1i(loc, value[0]!);
      else if (value.length === 2) gl.uniform2iv(loc, value);
      else if (value.length === 3) gl.uniform3iv(loc, value);
      else if (value.length === 4) gl.uniform4iv(loc, value);
      else gl.uniform1iv(loc, value);
    } else if (value instanceof Float32Array) gl.uniform1fv(loc, value);
    else {
      const arr = new Float32Array(value);
      if (arr.length === 2) gl.uniform2fv(loc, arr);
      else if (arr.length === 3) gl.uniform3fv(loc, arr);
      else if (arr.length === 4) gl.uniform4fv(loc, arr);
      else gl.uniform1fv(loc, arr);
    }
  }

  /** Run one op pass (doc-sized) from `inTex` (+ `sourceTex`) into `target`. */
  private runOpPass(source: string, uniforms: Record<string, UniformValue>, inTex: WebGLTexture, sourceTex: WebGLTexture, target: Fbo): void {
    const gl = this.gl;
    const p = this.opProgram(source);
    gl.useProgram(p.prog);
    this.currentProgram = p.prog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.docW, this.docH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    this.opUniform(p, "u_image", Int32Array.of(0));
    this.opUniform(p, "u_source", Int32Array.of(1));
    this.opUniform(p, "u_size", Int32Array.of(this.docW, this.docH));
    this.opUniform(p, "u_sourceSize", Int32Array.of(this.docW, this.docH));
    this.opUniform(p, "u_outSize", Int32Array.of(this.docW, this.docH));
    for (const [name, value] of Object.entries(uniforms)) this.opUniform(p, name, value);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.passes++;
  }

  private drawBlend(
    chain: Chain,
    srcTex: WebGLTexture,
    srcRect: Rect,
    opacity: number,
    mode: BlendMode,
    maskTex: WebGLTexture | null,
    clipTex: WebGLTexture | null,
    srcPremul: boolean,
    kind: "normal" | "lerp" | "adjust",
  ): void {
    const gl = this.gl;
    const target = chain.ping[chain.pi as 0 | 1];
    const prev = chain.cur;
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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, clipTex ?? srcTex);
    gl.uniform1i(p.u.u_prevValid, prev ? 1 : 0);
    gl.uniform1i(p.u.u_srcPremul, srcPremul ? 1 : 0);
    gl.uniform1i(p.u.u_hasMask, maskTex ? 1 : 0);
    gl.uniform1i(p.u.u_hasClip, clipTex ? 1 : 0);
    gl.uniform1i(p.u.u_lerp, kind === "lerp" ? 1 : 0);
    gl.uniform1i(p.u.u_adjust, kind === "adjust" ? 1 : 0);
    gl.uniform1i(p.u.u_mode, BLEND_MODE_INDEX[mode]);
    gl.uniform1f(p.u.u_opacity, opacity);
    gl.uniform4f(p.u.u_layerRect, srcRect.x, srcRect.y, srcRect.w, srcRect.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.passes++;
    chain.cur = target;
    chain.pi ^= 1;
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
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.channelTex ?? this.selTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.qmTex ?? this.selTex);

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
    const view = parseViewChannel(opts.viewChannel ?? "rgb");
    let mode = 0;
    if (view.kind === "r") mode = 1;
    else if (view.kind === "g") mode = 2;
    else if (view.kind === "b") mode = 3;
    else if ((view.kind === "alpha" || view.kind === "mask") && this.channelTex && this.channelKey !== "") mode = 4;
    gl.uniform1i(u.u_viewMode, mode);
    const qm = doc.quickMask;
    const qmOn = (opts.showQuickMask ?? true) && qm.active && !!this.qmTex && !!qm.raster;
    gl.uniform1i(u.u_qmActive, qmOn ? 1 : 0);
    gl.uniform3f(u.u_qmColor, qm.color.r / 255, qm.color.g / 255, qm.color.b / 255);
    gl.uniform1f(u.u_qmOpacity, qm.opacity);
    gl.uniform1i(u.u_qmMasked, qm.maskedAreas ? 1 : 0);
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
  debugState(): { layers: number; belowValid: boolean; belowIndex: number; docW: number; docH: number; styled: number; clips: number; cpuAdjustments: number } {
    let styled = 0;
    let clips = 0;
    for (const e of this.layers.values()) {
      if (e.styled) styled++;
      if (e.clipTex) clips++;
    }
    return { layers: this.layers.size, belowValid: this.belowValid, belowIndex: this.belowIndex, docW: this.docW, docH: this.docH, styled, clips, cpuAdjustments: this.cpuAdjustments };
  }
}

/** Group sibling layers into compositing units (base + clipped chain). */
export function buildUnits(siblings: readonly Layer[]): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  while (i < siblings.length) {
    const layer = siblings[i]!;
    const chain: Layer[] = [];
    let j = i + 1;
    if (layer.kind !== "group") {
      while (j < siblings.length && siblings[j]!.clipToBelow && siblings[j]!.kind !== "group") {
        chain.push(siblings[j]!);
        j++;
      }
    }
    units.push({ layer, chain });
    i = j;
  }
  return units;
}

function hasClippedAbove(doc: Document, layer: Layer): boolean {
  const i = doc.layers.indexOf(layer);
  const next = doc.layers[i + 1];
  return !!next && next.parentId === layer.parentId && next.clipToBelow && next.kind !== "group" && !layer.clipToBelow;
}
