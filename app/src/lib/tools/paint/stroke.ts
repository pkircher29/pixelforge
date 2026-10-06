/**
 * Stroke engine shared by Brush, Eraser and Clone Stamp.
 *
 * Model: a stroke owns a float coverage buffer the size of the layer. Each dab adds
 * `flow`-weighted coverage (accumulating, capped at 1); the pixel result is always
 * recomputed from the *pre-stroke snapshot* so overlapping dabs never exceed the stroke
 * `opacity` (Photoshop semantics). The selection mask clips coverage.
 */
import { PaintCommand, Rect, type Point, type Raster, type RasterLayer, type RGBA, type Selection } from "$lib/engine";
import { dabCoverage, interpolateDabs, spacingPx } from "./dab";

export type StrokeMode = "paint" | "erase" | "clone";

export interface StrokeOptions {
  mode: StrokeMode;
  color: RGBA;
  /** 0..1 */
  opacity: number;
  /** 0..1 */
  flow: number;
  /** 0..1 */
  hardness: number;
  /** % of diameter */
  spacing: number;
  /** Document selection (clip) or null. */
  selection: Selection | null;
  /** Layer offset in the document (selection is doc-space). */
  layerOffset: Point;
  /** Clone source: pixels and the layer-space offset `src = p + delta`. */
  source?: { raster: Raster; delta: Point } | undefined;
}

export class Stroke {
  readonly layer: RasterLayer;
  private readonly before: { rect: Rect; pixels: Raster };
  private readonly cov: Float32Array;
  private dirty: Rect | null = null;
  private last: Point | null = null;
  private carry = 0;
  private readonly opts: StrokeOptions;
  private readonly w: number;
  private readonly h: number;

  constructor(layer: RasterLayer, opts: StrokeOptions) {
    this.layer = layer;
    this.opts = opts;
    this.w = layer.raster.width;
    this.h = layer.raster.height;
    this.before = PaintCommand.capture(layer);
    this.cov = new Float32Array(this.w * this.h);
  }

  get dirtyRect(): Rect | null {
    return this.dirty;
  }

  /**
   * Advance the stroke to `p` (layer space) with the given diameter. Returns the
   * raster-space rect touched by this call (for `markDirty`), or null.
   */
  moveTo(p: Point, diameter: number): Rect | null {
    let touched: Rect | null = null;
    if (!this.last) {
      touched = this.stamp(p, diameter);
    } else {
      const { points, carry } = interpolateDabs(this.last, p, spacingPx(diameter, this.opts.spacing), this.carry);
      this.carry = carry;
      for (const q of points) touched = Rect.union(touched, this.stamp(q, diameter));
    }
    this.last = p;
    if (touched) this.dirty = Rect.union(this.dirty, touched);
    return touched;
  }

  /** Stamp a single dab and composite the affected pixels. */
  private stamp(c: Point, diameter: number): Rect | null {
    const r = Math.max(0.5, diameter / 2);
    const x0 = Math.max(0, Math.floor(c.x - r));
    const y0 = Math.max(0, Math.floor(c.y - r));
    const x1 = Math.min(this.w - 1, Math.ceil(c.x + r));
    const y1 = Math.min(this.h - 1, Math.ceil(c.y + r));
    if (x1 < x0 || y1 < y0) return null;
    const { flow, hardness, selection, layerOffset } = this.opts;
    const cov = this.cov;
    const w = this.w;
    const sel = selection && !selection.isEmpty ? selection : null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        let a = dabCoverage(d, r, hardness) * flow;
        if (a <= 0) continue;
        if (sel) {
          a *= sel.get(x + layerOffset.x, y + layerOffset.y) / 255;
          if (a <= 0) continue;
        }
        const i = y * w + x;
        cov[i] = cov[i]! + a * (1 - cov[i]!);
      }
    }
    const rect = Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.composite(rect);
    return rect;
  }

  /** Recompute layer pixels inside `rect` from the snapshot and the coverage buffer. */
  private composite(rect: Rect): void {
    const { mode, color, opacity, source } = this.opts;
    const dst = this.layer.raster.data;
    const src = this.before.pixels.data;
    const cov = this.cov;
    const w = this.w;
    const cr = color.r;
    const cg = color.g;
    const cb = color.b;
    const srcPx = { r: 0, g: 0, b: 0, a: 0 };
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = y * w + x;
        const a = cov[i]! * opacity;
        const p = i * 4;
        const br = src[p]!;
        const bg = src[p + 1]!;
        const bb = src[p + 2]!;
        const ba = src[p + 3]! / 255;
        if (a <= 0) {
          dst[p] = br;
          dst[p + 1] = bg;
          dst[p + 2] = bb;
          dst[p + 3] = src[p + 3]!;
          continue;
        }
        if (mode === "erase") {
          dst[p] = br;
          dst[p + 1] = bg;
          dst[p + 2] = bb;
          dst[p + 3] = ba * (1 - a) * 255;
          continue;
        }
        let sr = cr;
        let sg = cg;
        let sb = cb;
        let sa = a;
        if (mode === "clone") {
          if (!source) continue;
          source.raster.getPixel(x + source.delta.x, y + source.delta.y, srcPx);
          sr = srcPx.r;
          sg = srcPx.g;
          sb = srcPx.b;
          sa = a * (srcPx.a / 255);
          if (sa <= 0) {
            dst[p] = br;
            dst[p + 1] = bg;
            dst[p + 2] = bb;
            dst[p + 3] = src[p + 3]!;
            continue;
          }
        }
        // Straight-alpha "over".
        const ao = sa + ba * (1 - sa);
        const ws = sa / ao;
        const wd = (ba * (1 - sa)) / ao;
        dst[p] = sr * ws + br * wd;
        dst[p + 1] = sg * ws + bg * wd;
        dst[p + 2] = sb * ws + bb * wd;
        dst[p + 3] = ao * 255;
      }
    }
  }

  /** Build the undoable command (null if nothing was painted). */
  finish(label: string): PaintCommand | null {
    if (!this.dirty) return null;
    return PaintCommand.finish(this.layer, this.before, label, this.dirty);
  }

  /** Restore the snapshot (Esc during a stroke). Returns the rect to mark dirty. */
  abort(): Rect | null {
    if (!this.dirty) return null;
    // The snapshot is whole-layer, so source and destination coordinates coincide.
    this.layer.raster.blit(this.before.pixels, this.dirty.x, this.dirty.y, this.dirty, { mode: "replace" });
    return this.dirty;
  }
}
