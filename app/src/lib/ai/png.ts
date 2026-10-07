/**
 * PNG <-> `Raster` in the webview, using canvas APIs (no dependency on other agents'
 * commands). Note: canvas round-trips go through premultiplied alpha, so color values
 * of semi-transparent pixels can shift by a few units. Opaque pixels are exact.
 */

import { Raster } from "$lib/engine";

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: OffscreenCanvas | HTMLCanvasElement): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = (c as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("png: 2D canvas context unavailable");
  return ctx;
}

async function canvasToBlob(c: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob(quality === undefined ? { type } : { type, quality });
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("png: toBlob returned null"))), type, quality);
  });
}

/** Encode a raster as PNG bytes. */
export async function encodePng(raster: Raster): Promise<Uint8Array> {
  const c = makeCanvas(raster.width, raster.height);
  ctx2d(c).putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  const blob = await canvasToBlob(c, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decode PNG / JPEG / WebP bytes into a straight-alpha raster. */
export async function decodeImage(bytes: Uint8Array | Blob): Promise<Raster> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  try {
    const c = makeCanvas(bmp.width, bmp.height);
    const ctx = ctx2d(c);
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return Raster.fromImageData(img);
  } finally {
    bmp.close();
  }
}

/** Longest edge <= `maxPx`, never upscaled. */
export function thumbSize(w: number, h: number, maxPx: number): { w: number; h: number } {
  const s = Math.min(1, maxPx / Math.max(1, w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** A small JPEG/PNG data URL for history entries (<= `maxPx` on the longest edge). */
export async function thumbnailDataUrl(raster: Raster, maxPx = 160, opaque = false): Promise<string> {
  const { w, h } = thumbSize(raster.width, raster.height, maxPx);
  const src = makeCanvas(raster.width, raster.height);
  ctx2d(src).putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  const dst = makeCanvas(w, h);
  const ctx = ctx2d(dst);
  if (opaque) {
    ctx.fillStyle = "#1a1e27";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  const blob = await canvasToBlob(dst, opaque ? "image/jpeg" : "image/png", opaque ? 0.8 : undefined);
  return blobToDataUrl(blob);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

/** Grayscale coverage (0..255, `w*h`) -> opaque luma raster (white = editable). */
export function coverageToLumaRaster(coverage: Uint8Array, w: number, h: number): Raster {
  const r = new Raster(w, h);
  const d = r.data;
  for (let i = 0, p = 0; i < coverage.length; i++, p += 4) {
    const v = coverage[i]!;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  return r;
}
