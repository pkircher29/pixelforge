/**
 * Thumbnails for the Layers / Channels / Paths panels: nearest-neighbour samples of a
 * raster into a small RGBA buffer (pure, testable) plus canvas painters that add the
 * PS checkerboard, hairline and mask / channel treatments.
 */
import { Rect, Raster, flattenPath, renderFill, type Layer, type Path } from "$lib/engine";
import type { ThumbContents, ThumbSize } from "./Layers.store.svelte";

/** Thumbnail box limits per PS "Thumbnail Size". */
export const THUMB_BOX: Record<Exclude<ThumbSize, "none">, { w: number; h: number; row: number }> = {
  small: { w: 28, h: 20, row: 26 },
  medium: { w: 52, h: 34, row: 40 },
  large: { w: 76, h: 54, row: 60 },
};

/** Row height for a thumbnail size. */
export function rowHeight(size: ThumbSize): number {
  return size === "none" ? 22 : THUMB_BOX[size].row;
}

/** Thumb dimensions: the document's aspect fitted into the box (never thinner than half the box). */
export function thumbDims(size: ThumbSize, docW: number, docH: number): { w: number; h: number } {
  if (size === "none") return { w: 0, h: 0 };
  const box = THUMB_BOX[size];
  const aspect = Math.max(0.5, Math.min(2.5, docW / Math.max(1, docH)));
  let w = box.h * aspect;
  let h = box.h;
  if (w > box.w) {
    w = box.w;
    h = box.w / aspect;
  }
  return { w: Math.max(8, Math.round(w)), h: Math.max(8, Math.round(h)) };
}

/**
 * Sample `raster` (placed at `offset` in a `srcRect`-sized space) into `out`
 * (`tw × th` RGBA), fitting `srcRect` into the thumb centred. Pixels outside the raster
 * stay transparent.
 */
export function sampleRaster(raster: Raster, offset: { x: number; y: number }, srcRect: Rect, out: Uint8ClampedArray, tw: number, th: number): void {
  out.fill(0);
  if (srcRect.w <= 0 || srcRect.h <= 0 || tw <= 0 || th <= 0) return;
  const scale = Math.min(tw / srcRect.w, th / srcRect.h);
  const fw = Math.max(1, Math.round(srcRect.w * scale));
  const fh = Math.max(1, Math.round(srcRect.h * scale));
  const ox = Math.floor((tw - fw) / 2);
  const oy = Math.floor((th - fh) / 2);
  const d = raster.data;
  for (let y = 0; y < fh; y++) {
    const dy = Math.floor(srcRect.y + ((y + 0.5) / fh) * srcRect.h) - offset.y;
    if (dy < 0 || dy >= raster.height) continue;
    for (let x = 0; x < fw; x++) {
      const dx = Math.floor(srcRect.x + ((x + 0.5) / fw) * srcRect.w) - offset.x;
      if (dx < 0 || dx >= raster.width) continue;
      const si = (dy * raster.width + dx) * 4;
      const oi = ((oy + y) * tw + ox + x) * 4;
      out[oi] = d[si]!;
      out[oi + 1] = d[si + 1]!;
      out[oi + 2] = d[si + 2]!;
      out[oi + 3] = d[si + 3]!;
    }
  }
}

/** Source rect for a pixel layer: the document or the layer's own bounds. */
export function thumbSourceRect(layer: Layer, docW: number, docH: number, contents: ThumbContents): Rect {
  if (contents === "bounds" && (layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text")) {
    const bb = layer.raster.boundingBoxOfAlpha(0);
    if (bb) return Rect.make(bb.x + layer.offset.x, bb.y + layer.offset.y, bb.w, bb.h);
    return Rect.make(layer.offset.x, layer.offset.y, layer.raster.width, layer.raster.height);
  }
  return Rect.ofSize(docW, docH);
}

/** Fill `out` with a layer's thumbnail (pixel layers sample; fill layers render; others stay transparent). */
export function sampleLayerThumb(layer: Layer, docW: number, docH: number, out: Uint8ClampedArray, tw: number, th: number, contents: ThumbContents = "document"): void {
  if (layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text") {
    sampleRaster(layer.raster, layer.offset, thumbSourceRect(layer, docW, docH, contents), out, tw, th);
    return;
  }
  if (layer.kind === "fill") {
    const r = renderFill(layer.fill, tw, th);
    out.set(r.data);
    return;
  }
  out.fill(0);
}

/** Grayscale mask thumbnail: white (reveal) outside a layer-sized mask, black/white inside. */
export function sampleMaskThumb(layer: Layer, docW: number, docH: number, out: Uint8ClampedArray, tw: number, th: number): void {
  out.fill(255);
  const m = layer.mask;
  if (!m) return;
  const isPixel = layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text";
  const off = isPixel ? layer.offset : { x: 0, y: 0 };
  const tmp = new Uint8ClampedArray(tw * th * 4);
  sampleRaster(m, off, Rect.ofSize(docW, docH), tmp, tw, th);
  for (let i = 0; i < tmp.length; i += 4) {
    if (tmp[i + 3] === 0) continue;
    const v = tmp[i]!;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
}

/** Grayscale channel thumbnail (value in R of a document-sized raster). */
export function sampleChannelThumb(channel: Raster, out: Uint8ClampedArray, tw: number, th: number): void {
  sampleRaster(channel, { x: 0, y: 0 }, Rect.ofSize(channel.width, channel.height), out, tw, th);
  for (let i = 0; i < out.length; i += 4) {
    const v = out[i]!;
    out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
}

/** v0.1 signature kept for callers / tests: 44 × 32 document-placement sample. */
export function sampleThumb(layer: Layer, docW: number, docH: number, out: Uint8ClampedArray, tw = 44, th = 32): void {
  sampleLayerThumb(layer, docW, docH, out, tw, th, "document");
}

// ---------------------------------------------------------------------------
// Canvas painters
// ---------------------------------------------------------------------------

function ensureSize(canvas: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** PS transparency grid (white / #cbcbcb, 4 px cells at thumb scale). */
export function drawChecker(g: CanvasRenderingContext2D, w: number, h: number, cell = 4): void {
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#cbcbcb";
  for (let y = 0; y < h; y += cell) for (let x = ((y / cell) & 1) * cell; x < w; x += cell * 2) g.fillRect(x, y, cell, cell);
}

export function drawLayerThumb(canvas: HTMLCanvasElement, layer: Layer, docW: number, docH: number, tw: number, th: number, contents: ThumbContents = "document"): void {
  ensureSize(canvas, tw, th);
  const g = canvas.getContext("2d");
  if (!g) return;
  drawChecker(g, tw, th);
  const img = g.createImageData(tw, th);
  sampleLayerThumb(layer, docW, docH, img.data, tw, th, contents);
  const tmp = document.createElement("canvas");
  tmp.width = tw;
  tmp.height = th;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  g.drawImage(tmp, 0, 0);
}

export function drawMaskThumb(canvas: HTMLCanvasElement, layer: Layer, docW: number, docH: number, tw: number, th: number): void {
  ensureSize(canvas, tw, th);
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(tw, th);
  sampleMaskThumb(layer, docW, docH, img.data, tw, th);
  g.putImageData(img, 0, 0);
}

export function drawChannelThumb(canvas: HTMLCanvasElement, channel: Raster, tw: number, th: number): void {
  ensureSize(canvas, tw, th);
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(tw, th);
  sampleChannelThumb(channel, img.data, tw, th);
  g.putImageData(img, 0, 0);
}

/** Path outline on white, like the Paths panel. */
export function drawPathThumb(canvas: HTMLCanvasElement, path: Path, docW: number, docH: number, tw: number, th: number): void {
  ensureSize(canvas, tw, th);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, tw, th);
  const scale = Math.min(tw / Math.max(1, docW), th / Math.max(1, docH));
  const ox = (tw - docW * scale) / 2;
  const oy = (th - docH * scale) / 2;
  g.strokeStyle = "#333333";
  g.lineWidth = 1;
  g.fillStyle = "rgba(0,0,0,0.12)";
  for (const sp of flattenPath(path, 0.5)) {
    if (sp.points.length < 2) continue;
    g.beginPath();
    sp.points.forEach((p, i) => (i === 0 ? g.moveTo(ox + p.x * scale, oy + p.y * scale) : g.lineTo(ox + p.x * scale, oy + p.y * scale)));
    if (sp.closed) {
      g.closePath();
      g.fill();
    }
    g.stroke();
  }
}

/** Render an RGBA buffer straight into a canvas (Layer Style preset thumbnails). */
export function drawRasterToCanvas(canvas: HTMLCanvasElement, raster: Raster, bg: "checker" | "none" = "checker"): void {
  ensureSize(canvas, raster.width, raster.height);
  const g = canvas.getContext("2d");
  if (!g) return;
  if (bg === "checker") drawChecker(g, raster.width, raster.height, 6);
  const tmp = document.createElement("canvas");
  tmp.width = raster.width;
  tmp.height = raster.height;
  tmp.getContext("2d")?.putImageData(raster.toImageData(), 0, 0);
  g.drawImage(tmp, 0, 0);
}
