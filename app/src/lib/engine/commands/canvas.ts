/**
 * Canvas Size (anchor grid) and Image Size (resample everything).
 *
 * Besides pixel layers these move / resize layer masks, alpha channels, the quick mask,
 * paths (anchors are translated / scaled) and re-rasterize shape and text layers.
 */

import type { Rect } from "../rect";
import { Raster } from "../raster";
import { Selection } from "../selection";
import { MAX_CANVAS_SIZE, rerasterizeShape, rerasterizeText } from "../document";
import type { Document, Layer, Path, ResampleMethod } from "../types";
import { StructuralCommand } from "./structural";

function selectionFromLuminance(lum: Raster): Selection {
  return Selection.fromLuminance(lum);
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

/** Re-create a gray channel raster at a new size, shifted by `dx, dy`, new areas white. */
function reframeChannel(src: Raster, w: number, h: number, dx: number, dy: number, fill = 255): Raster {
  const m = Raster.filled(w, h, { r: fill, g: fill, b: fill, a: 255 });
  m.blit(src, dx, dy, undefined, { mode: "replace" });
  return m;
}

function translatePathInPlace(p: Path, dx: number, dy: number): void {
  for (const s of p.subpaths) {
    for (const a of s.anchors) {
      a.x += dx;
      a.y += dy;
      a.inX += dx;
      a.inY += dy;
      a.outX += dx;
      a.outY += dy;
    }
  }
}

function scalePathInPlace(p: Path, sx: number, sy: number): void {
  for (const s of p.subpaths) {
    for (const a of s.anchors) {
      a.x *= sx;
      a.y *= sy;
      a.inX *= sx;
      a.inY *= sy;
      a.outX *= sx;
      a.outY *= sy;
    }
  }
}

/** Shift / re-frame one layer for a canvas change (`dx, dy` = where the old canvas origin lands). */
function reframeLayer(doc: Document, layer: Layer, w: number, h: number, dx: number, dy: number): void {
  if (layer.kind === "raster") {
    const ox = layer.offset.x + dx;
    const oy = layer.offset.y + dy;
    const next = new Raster(w, h);
    next.blit(layer.raster, ox, oy, undefined, { mode: "replace" });
    layer.raster = next;
    if (layer.mask) layer.mask = reframeChannel(layer.mask, w, h, ox, oy);
    layer.offset = { x: 0, y: 0 };
    return;
  }
  if (layer.kind === "shape") {
    translatePathInPlace(layer.path, dx + layer.offset.x, dy + layer.offset.y);
    if (layer.mask) layer.mask = reframeChannel(layer.mask, w, h, layer.offset.x + dx, layer.offset.y + dy);
    layer.offset = { x: 0, y: 0 };
    rerasterizeShape(doc, layer);
    return;
  }
  if (layer.kind === "text") {
    layer.text = { ...layer.text, x: layer.text.x + dx + layer.offset.x, y: layer.text.y + dy + layer.offset.y };
    if (layer.mask) layer.mask = reframeChannel(layer.mask, w, h, layer.offset.x + dx, layer.offset.y + dy);
    layer.offset = { x: 0, y: 0 };
    rerasterizeText(doc, layer);
    return;
  }
  // Group / adjustment / fill: only a document-sized mask to re-frame.
  if (layer.mask) layer.mask = reframeChannel(layer.mask, w, h, layer.offset.x + dx, layer.offset.y + dy);
  layer.offset = { x: 0, y: 0 };
}

function reframeDocument(doc: Document, w: number, h: number, dx: number, dy: number): void {
  // Shape / text layers read `doc.width/height` when rasterizing: set the size first.
  const oldW = doc.width;
  const oldH = doc.height;
  doc.width = w;
  doc.height = h;
  for (const layer of doc.layers) reframeLayer(doc, layer, w, h, dx, dy);
  const sel = doc.selection.translate(dx, dy);
  const resized = new Raster(w, h);
  resized.blit(sel.toLuminanceMask(), 0, 0, undefined, { mode: "replace" });
  doc.selection = selectionFromLuminance(resized);
  doc.alphaChannels = doc.alphaChannels.map((c) => ({ ...c, mask: reframeChannel(c.mask, w, h, dx, dy, 0) }));
  if (doc.quickMask.raster) doc.quickMask.raster = reframeChannel(doc.quickMask.raster, w, h, dx, dy, 0);
  for (const p of doc.paths) translatePathInPlace(p, dx, dy);
  void oldW;
  void oldH;
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
    reframeDocument(doc, this.w, this.h, dx, dy);
  }
}

/** Scale the whole image (all layers, masks, channels, paths and the selection). */
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
    doc.width = this.w;
    doc.height = this.h;
    for (const layer of doc.layers) {
      if (layer.kind === "raster") {
        const nw = Math.max(1, Math.round(layer.raster.width * sx));
        const nh = Math.max(1, Math.round(layer.raster.height * sy));
        layer.raster = layer.raster.resize(nw, nh, this.method);
        if (layer.mask) layer.mask = layer.mask.resize(nw, nh, this.method);
        layer.offset = { x: Math.round(layer.offset.x * sx), y: Math.round(layer.offset.y * sy) };
        continue;
      }
      if (layer.kind === "shape") {
        scalePathInPlace(layer.path, sx, sy);
        if (layer.stroke) layer.stroke = { ...layer.stroke, width: layer.stroke.width * Math.sqrt(sx * sy) };
        layer.offset = { x: Math.round(layer.offset.x * sx), y: Math.round(layer.offset.y * sy) };
        if (layer.mask) layer.mask = layer.mask.resize(this.w, this.h, this.method);
        rerasterizeShape(doc, layer);
        continue;
      }
      if (layer.kind === "text") {
        layer.text = { ...layer.text, x: layer.text.x * sx, y: layer.text.y * sy, size: layer.text.size * Math.sqrt(sx * sy), leading: layer.text.leading === null ? null : layer.text.leading * sy };
        layer.offset = { x: Math.round(layer.offset.x * sx), y: Math.round(layer.offset.y * sy) };
        if (layer.mask) layer.mask = layer.mask.resize(this.w, this.h, this.method);
        rerasterizeText(doc, layer);
        continue;
      }
      if (layer.mask) layer.mask = layer.mask.resize(this.w, this.h, this.method);
    }
    doc.selection = doc.selection.resized(this.w, this.h);
    doc.alphaChannels = doc.alphaChannels.map((c) => ({ ...c, mask: c.mask.resize(this.w, this.h, this.method) }));
    if (doc.quickMask.raster) doc.quickMask.raster = doc.quickMask.raster.resize(this.w, this.h, this.method);
    for (const p of doc.paths) scalePathInPlace(p, sx, sy);
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
    reframeDocument(doc, r.w, r.h, -r.x, -r.y);
  }
}
