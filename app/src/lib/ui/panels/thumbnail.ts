/**
 * Layer thumbnails: nearest-neighbour downsample of a layer into a small canvas that
 * shows the layer's placement within the document bounds. Pure CPU, cheap for any size.
 */
import type { Layer } from "$lib/engine";

export const THUMB_W = 44;
export const THUMB_H = 32;

/** Fill `out` (THUMB_W x THUMB_H RGBA) with the layer sampled over the document rect. */
export function sampleThumb(layer: Layer, docW: number, docH: number, out: Uint8ClampedArray, tw = THUMB_W, th = THUMB_H): void {
  out.fill(0);
  if (layer.kind !== "raster") return;
  // Fit the document into the thumb, centred.
  const scale = Math.min(tw / Math.max(1, docW), th / Math.max(1, docH));
  const fw = Math.max(1, Math.round(docW * scale));
  const fh = Math.max(1, Math.round(docH * scale));
  const ox = Math.floor((tw - fw) / 2);
  const oy = Math.floor((th - fh) / 2);
  const r = layer.raster;
  const d = r.data;
  for (let y = 0; y < fh; y++) {
    const dy = Math.floor(((y + 0.5) / fh) * docH) - layer.offset.y;
    if (dy < 0 || dy >= r.height) continue;
    for (let x = 0; x < fw; x++) {
      const dx = Math.floor(((x + 0.5) / fw) * docW) - layer.offset.x;
      if (dx < 0 || dx >= r.width) continue;
      const si = (dy * r.width + dx) * 4;
      const oi = ((oy + y) * tw + ox + x) * 4;
      out[oi] = d[si]!;
      out[oi + 1] = d[si + 1]!;
      out[oi + 2] = d[si + 2]!;
      out[oi + 3] = d[si + 3]!;
    }
  }
}

export function drawThumb(canvas: HTMLCanvasElement, layer: Layer, docW: number, docH: number): void {
  if (canvas.width !== THUMB_W || canvas.height !== THUMB_H) {
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(THUMB_W, THUMB_H);
  sampleThumb(layer, docW, docH, img.data);
  g.putImageData(img, 0, 0);
}
