/**
 * Copy / paste pixels through the OS clipboard (`@tauri-apps/plugin-clipboard-manager`).
 * Images cross as raw RGBA via `Image.new`, so no PNG round trip is needed.
 */
import { isTauri } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { readImage, writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { Raster, Rect, activeLayer, compositeToRaster, type Document, type Point } from "$lib/engine";

/**
 * Pixels to copy: the composite inside the selection bbox (masked by the selection),
 * or the whole active layer when nothing is selected. Null when there is nothing.
 */
export function copyRegion(doc: Document, opts: { layerOnly?: boolean } = {}): { raster: Raster; origin: Point } | null {
  const sel = doc.selection;
  const layer = activeLayer(doc);
  if (sel.isEmpty) {
    if (!layer || layer.kind !== "raster") return null;
    const bb = layer.raster.boundingBoxOfAlpha();
    if (!bb) return null;
    return { raster: layer.raster.crop(bb), origin: { x: layer.offset.x + bb.x, y: layer.offset.y + bb.y } };
  }
  const bb = sel.bbox!;
  let src: Raster;
  let origin: Point;
  if (opts.layerOnly && layer && layer.kind === "raster") {
    const r = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
    if (Rect.isEmpty(r)) return null;
    src = layer.raster.crop(r);
    origin = { x: r.x + layer.offset.x, y: r.y + layer.offset.y };
  } else {
    src = compositeToRaster(doc, { rect: bb }).crop(bb);
    origin = { x: bb.x, y: bb.y };
  }
  // Apply the selection coverage as alpha.
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const m = sel.get(origin.x + x, origin.y + y);
      if (m === 255) continue;
      const p = (y * src.width + x) * 4 + 3;
      d[p] = (d[p]! * m) / 255;
    }
  }
  return { raster: src, origin };
}

export async function writeRasterToClipboard(r: Raster): Promise<void> {
  if (!isTauri()) throw { code: "no_tauri", message: "The clipboard needs the desktop app." };
  const img = await Image.new(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength), r.width, r.height);
  await writeImage(img);
}

/** Read an image from the clipboard, or null when it holds none. */
export async function readRasterFromClipboard(): Promise<Raster | null> {
  if (!isTauri()) return null;
  let img: Image;
  try {
    img = await readImage();
  } catch {
    return null;
  }
  const { width, height } = await img.size();
  if (width <= 0 || height <= 0) return null;
  const rgba = await img.rgba();
  if (rgba.byteLength !== width * height * 4) return null;
  return Raster.fromBytes(width, height, rgba);
}
