/**
 * Canvas-2D fallback compositor: runs the CPU compositor into an offscreen canvas and
 * draws it through the viewport transform. Correct but not fast; used only when WebGL2
 * is unavailable.
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import type { Selection } from "../selection";
import { compositeToRaster } from "../document";
import type { BlendMode, Document, ICompositor, LayerId, RenderOptions, RenderStats } from "../types";
import type { Viewport } from "../viewport";
import { computeSelectionEdge } from "./ants";
import { DirtyTracker } from "./dirty";
import { DEFAULT_COMPOSITOR_COLORS, type CompositorColors } from "./GlCompositor";

interface LayerCache {
  raster: Raster | null;
  mask: Raster | null;
  offX: number;
  offY: number;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  parentId: LayerId | null;
  docRect: Rect;
}

function css(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

export class CanvasCompositor implements ICompositor {
  readonly kind = "canvas2d" as const;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly colors: CompositorColors;

  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private composite: Raster | null = null;
  private imageData: ImageData | null = null;
  private docW = 0;
  private docH = 0;

  private readonly cache = new Map<LayerId, LayerCache>();
  private prevOrder: LayerId[] = [];
  private readonly dirty = new DirtyTracker();
  private forceFullNext = true;

  private lastSelection: Selection | null = null;
  private edge: Int32Array = new Int32Array(0);
  private checker: CanvasPattern | null = null;
  private checkerSize = 0;

  private readonly mat = new Float32Array(9);
  private readonly stats: RenderStats = { drawn: false, recomposited: false, compositedArea: 0, passes: 0, uploads: 0 };

  constructor(canvas: HTMLCanvasElement, opts: { colors?: CompositorColors } = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.colors = opts.colors ?? DEFAULT_COMPOSITOR_COLORS;
  }

  isContextLost(): boolean {
    return false;
  }

  markDirty(layerId: LayerId, rect?: Rect): void {
    this.dirty.mark(layerId, rect);
  }

  invalidateAll(): void {
    this.forceFullNext = true;
    this.lastSelection = null;
  }

  dispose(): void {
    this.off = null;
    this.offCtx = null;
    this.composite = null;
    this.imageData = null;
    this.cache.clear();
  }

  private ensureBuffers(w: number, h: number): boolean {
    if (this.composite && this.docW === w && this.docH === h) return false;
    this.docW = w;
    this.docH = h;
    this.composite = new Raster(w, h);
    this.imageData = this.composite.toImageData();
    this.off = document.createElement("canvas");
    this.off.width = w;
    this.off.height = h;
    this.offCtx = this.off.getContext("2d");
    return true;
  }

  render(doc: Document, viewport: Viewport, opts: RenderOptions = {}): RenderStats {
    const st = this.stats;
    st.drawn = false;
    st.recomposited = false;
    st.compositedArea = 0;
    st.passes = 0;
    st.uploads = 0;
    const W = opts.width ?? this.canvas.width;
    const H = opts.height ?? this.canvas.height;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    let full = this.ensureBuffers(doc.width, doc.height) || this.forceFullNext || opts.forceFull === true;
    this.forceFullNext = false;

    // Structure / props diff.
    const layers = doc.layers;
    if (!full && layers.length !== this.prevOrder.length) full = true;
    let dirtyDoc: Rect | null = null;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      if (!full && l.id !== this.prevOrder[i]) full = true;
      const docRect = l.kind === "raster" ? Rect.make(l.offset.x, l.offset.y, l.raster.width, l.raster.height) : Rect.ofSize(doc.width, doc.height);
      const c = this.cache.get(l.id);
      if (!c) {
        this.cache.set(l.id, {
          raster: l.raster,
          mask: l.mask,
          offX: l.offset.x,
          offY: l.offset.y,
          opacity: l.opacity,
          blendMode: l.blendMode,
          visible: l.visible,
          parentId: l.parentId,
          docRect,
        });
        full = true;
        continue;
      }
      if (
        c.raster !== l.raster ||
        c.mask !== l.mask ||
        c.offX !== l.offset.x ||
        c.offY !== l.offset.y ||
        c.opacity !== l.opacity ||
        c.blendMode !== l.blendMode ||
        c.visible !== l.visible ||
        c.parentId !== l.parentId
      ) {
        dirtyDoc = Rect.union(dirtyDoc, Rect.union(c.docRect, docRect));
        c.raster = l.raster;
        c.mask = l.mask;
        c.offX = l.offset.x;
        c.offY = l.offset.y;
        c.opacity = l.opacity;
        c.blendMode = l.blendMode;
        c.visible = l.visible;
        c.parentId = l.parentId;
        c.docRect = docRect;
      }
      const d = this.dirty.take(l.id);
      if (d === "full") dirtyDoc = Rect.union(dirtyDoc, docRect);
      else if (d) dirtyDoc = Rect.union(dirtyDoc, Rect.translate(d, l.offset.x, l.offset.y));
    }
    for (const id of this.cache.keys()) {
      if (!layers.some((l) => l.id === id)) {
        this.cache.delete(id);
        full = true;
      }
    }
    this.prevOrder = layers.map((l) => l.id);
    this.dirty.clear();
    if (full) dirtyDoc = Rect.ofSize(doc.width, doc.height);

    const composite = this.composite;
    const offCtx = this.offCtx;
    const imageData = this.imageData;
    if (!composite || !offCtx || !imageData || !this.off) return st;

    if (dirtyDoc) {
      const rect = Rect.intersect(dirtyDoc, Rect.ofSize(doc.width, doc.height));
      if (!Rect.isEmpty(rect)) {
        compositeToRaster(doc, { rect, into: composite });
        offCtx.putImageData(imageData, 0, 0, rect.x, rect.y, rect.w, rect.h);
        st.recomposited = true;
        st.compositedArea = rect.w * rect.h;
        st.passes = 1;
      }
    }

    this.draw(doc, viewport, opts, W, H);
    st.drawn = true;
    return st;
  }

  private draw(doc: Document, viewport: Viewport, opts: RenderOptions, W: number, H: number): void {
    const ctx = this.ctx;
    const dpr = opts.dpr ?? 1;
    const zoom = viewport.zoom * dpr;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(c.bg);
    ctx.fillRect(0, 0, W, H);

    const m = viewport.matrix(this.mat, dpr);
    ctx.save();
    ctx.setTransform(m[0]!, m[1]!, m[3]!, m[4]!, m[6]!, m[7]!);
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    // Checkerboard in screen space.
    const cell = Math.max(1, opts.checkerSize ?? 8);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.checkerPattern(cell) ?? css(c.light);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.imageSmoothingEnabled = zoom < 1;
    if (this.off) ctx.drawImage(this.off, 0, 0);
    // Pixel grid.
    if ((opts.showPixelGrid ?? true) && zoom >= (opts.pixelGridMinZoom ?? 8)) {
      const tl = viewport.screenToDoc({ x: 0, y: 0 });
      const br = viewport.screenToDoc({ x: W / dpr, y: H / dpr });
      const x0 = Math.max(0, Math.floor(Math.min(tl.x, br.x)));
      const x1 = Math.min(doc.width, Math.ceil(Math.max(tl.x, br.x)));
      const y0 = Math.max(0, Math.floor(Math.min(tl.y, br.y)));
      const y1 = Math.min(doc.height, Math.ceil(Math.max(tl.y, br.y)));
      ctx.strokeStyle = "rgba(128,128,128,0.35)";
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Marching ants in screen space.
    if ((opts.showSelection ?? true) && !doc.selection.isEmpty) {
      if (doc.selection !== this.lastSelection) {
        this.edge = computeSelectionEdge(doc.selection);
        this.lastSelection = doc.selection;
      }
      const phase = opts.antsPhase ?? 0;
      const w = doc.width;
      const stride = Math.max(1, Math.ceil(this.edge.length / 400_000));
      const pt = { x: 0, y: 0 };
      const out = { x: 0, y: 0 };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? "#000" : "#fff";
        for (let i = 0; i < this.edge.length; i += stride) {
          const idx = this.edge[i]!;
          pt.x = (idx % w) + 0.5;
          pt.y = Math.floor(idx / w) + 0.5;
          viewport.docToScreen(pt, out);
          const sx = Math.floor(out.x * dpr);
          const sy = Math.floor(out.y * dpr);
          const dash = Math.floor((sx + sy + phase) / 4) % 2;
          if ((dash + 2) % 2 === pass) ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
  }

  private checkerPattern(cell: number): CanvasPattern | null {
    if (this.checker && this.checkerSize === cell) return this.checker;
    const c = document.createElement("canvas");
    c.width = cell * 2;
    c.height = cell * 2;
    const cx = c.getContext("2d");
    if (!cx) return null;
    cx.fillStyle = css(this.colors.light);
    cx.fillRect(0, 0, cell * 2, cell * 2);
    cx.fillStyle = css(this.colors.dark);
    cx.fillRect(cell, 0, cell, cell);
    cx.fillRect(0, cell, cell, cell);
    this.checker = this.ctx.createPattern(c, "repeat");
    this.checkerSize = cell;
    return this.checker;
  }
}
