/**
 * Canvas Size (anchor grid) and Image Size (resample everything).
 */

import type { Rect } from "../rect";
import { Raster } from "../raster";
import { Selection } from "../selection";
import { MAX_CANVAS_SIZE } from "../document";
import type { Document, ResampleMethod } from "../types";
import { StructuralCommand } from "./structural";

function selectionFromLuminance(lum: Raster): Selection {
  const s = new Selection(lum.width, lum.height);
  const d = lum.data;
  for (let i = 0, p = 0; i < s.mask.length; i++, p += 4) s.mask[i] = d[p]!;
  return s;
}

/** Anchor as fractions: `{ x: 0, y: 0 }` top-left, `{ x: 0.5, y: 0.5 }` centre, `{ x: 1, y: 1 }` bottom-right. */
export interface CanvasAnchor {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

function checkSize(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) {
    throw new RangeError(`Invalid canvas size ${w}x${h}`);
  }
}

/**
 * Change the canvas size without scaling pixels. Layer rasters are re-created at the new
 * canvas size (v1 full-canvas buffers); content outside the new canvas is discarded.
 */
export class ResizeCanvasCommand extends StructuralCommand {
  readonly label = "Canvas Size";
  private readonly w: number;
  private readonly h: number;
  private readonly anchor: CanvasAnchor;

  constructor(width: number, height: number, anchor: CanvasAnchor = { x: 0.5, y: 0.5 }) {
    super();
    checkSize(width, height);
    this.w = width;
    this.h = height;
    this.anchor = anchor;
  }

  protected apply(doc: Document): void {
    const dx = Math.round((this.w - doc.width) * this.anchor.x);
    const dy = Math.round((this.h - doc.height) * this.anchor.y);
    for (const layer of doc.layers) {
      if (layer.kind !== "raster") continue;
      const ox = layer.offset.x + dx;
      const oy = layer.offset.y + dy;
      const next = new Raster(this.w, this.h);
      next.blit(layer.raster, ox, oy, undefined, { mode: "replace" });
      layer.raster = next;
      if (layer.mask) {
        const m = Raster.filled(this.w, this.h, { r: 255, g: 255, b: 255, a: 255 });
        m.blit(layer.mask, ox, oy, undefined, { mode: "replace" });
        layer.mask = m;
      }
      layer.offset = { x: 0, y: 0 };
    }
    const sel = doc.selection.translate(dx, dy);
    const resized = new Raster(this.w, this.h);
    resized.blit(sel.toLuminanceMask(), 0, 0, undefined, { mode: "replace" });
    doc.selection = selectionFromLuminance(resized);
    doc.width = this.w;
    doc.height = this.h;
  }
}

/** Scale the whole image (all layers, masks and the selection). */
export class ResizeImageCommand extends StructuralCommand {
  readonly label = "Image Size";
  private readonly w: number;
  private readonly h: number;
  private readonly method: ResampleMethod;

  constructor(width: number, height: number, method: ResampleMethod = "bicubic") {
    super();
    checkSize(width, height);
    this.w = width;
    this.h = height;
    this.method = method;
  }

  protected apply(doc: Document): void {
    const sx = this.w / doc.width;
    const sy = this.h / doc.height;
    for (const layer of doc.layers) {
      if (layer.kind !== "raster") continue;
      const nw = Math.max(1, Math.round(layer.raster.width * sx));
      const nh = Math.max(1, Math.round(layer.raster.height * sy));
      layer.raster = layer.raster.resize(nw, nh, this.method);
      if (layer.mask) layer.mask = layer.mask.resize(nw, nh, this.method);
      layer.offset = { x: Math.round(layer.offset.x * sx), y: Math.round(layer.offset.y * sy) };
    }
    doc.selection = doc.selection.resized(this.w, this.h);
    doc.width = this.w;
    doc.height = this.h;
  }
}

/** Crop the document to `rect` (Crop tool / Trim). */
export class CropCanvasCommand extends StructuralCommand {
  readonly label = "Crop";
  private readonly rect: Rect;

  constructor(rect: Rect) {
    super();
    checkSize(rect.w, rect.h);
    this.rect = { ...rect };
  }

  protected apply(doc: Document): void {
    const r = this.rect;
    for (const layer of doc.layers) {
      if (layer.kind !== "raster") continue;
      const next = new Raster(r.w, r.h);
      next.blit(layer.raster, layer.offset.x - r.x, layer.offset.y - r.y, undefined, { mode: "replace" });
      layer.raster = next;
      if (layer.mask) {
        const m = Raster.filled(r.w, r.h, { r: 255, g: 255, b: 255, a: 255 });
        m.blit(layer.mask, layer.offset.x - r.x, layer.offset.y - r.y, undefined, { mode: "replace" });
        layer.mask = m;
      }
      layer.offset = { x: 0, y: 0 };
    }
    const lum = doc.selection.toLuminanceMask().crop(r);
    doc.selection = selectionFromLuminance(lum);
    doc.width = r.w;
    doc.height = r.h;
  }
}
