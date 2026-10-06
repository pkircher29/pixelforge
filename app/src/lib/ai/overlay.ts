/**
 * The "AI diff" overlay: a temporary, non-undoable layer that paints magenta over every
 * pixel an AI result layer changed. Toggled per result layer; never pushed into history.
 *
 * Integration note: overlay layers have ids starting with `aidiff_` and should be skipped
 * by save/export (`isDiffOverlayLayer`). `removeAllDiffOverlays` exists for that path.
 */

import { compositeToRaster, createRasterLayer, findLayer, newId, type Document, type Layer } from "$lib/engine";
import type { OpenDoc } from "$lib/stores/doc.svelte";
import { diffRasters } from "./diff";

export const DIFF_LAYER_PREFIX = "aidiff_";
export const DIFF_LAYER_NAME = "AI diff";

export interface DiffOverlayInfo {
  layerId: string;
  /** The AI result layer the overlay was computed for. */
  forLayerId: string;
  changed: number;
  fraction: number;
}

const overlays = new Map<string, DiffOverlayInfo>();

export function isDiffOverlayLayer(layer: Layer): boolean {
  return layer.id.startsWith(DIFF_LAYER_PREFIX);
}

export function diffOverlayFor(doc: Document): DiffOverlayInfo | null {
  const info = overlays.get(doc.id);
  if (!info) return null;
  if (!findLayer(doc, info.layerId)) {
    overlays.delete(doc.id);
    return null;
  }
  return info;
}

/** Is the overlay currently showing for this result layer? */
export function isDiffShown(doc: Document, forLayerId: string): boolean {
  return diffOverlayFor(doc)?.forLayerId === forLayerId;
}

function bump(open: OpenDoc): void {
  open.compositor?.invalidateAll();
  open.version++;
}

export function removeDiffOverlay(open: OpenDoc): boolean {
  const info = diffOverlayFor(open.doc);
  if (!info) return false;
  open.doc.layers = open.doc.layers.filter((l) => l.id !== info.layerId);
  overlays.delete(open.doc.id);
  bump(open);
  return true;
}

/** Strip every overlay from a document (call before saving / exporting). */
export function removeAllDiffOverlays(doc: Document): void {
  doc.layers = doc.layers.filter((l) => !isDiffOverlayLayer(l));
  overlays.delete(doc.id);
}

/**
 * A shallow view of `doc` without any diff overlay layers, for save / export / copy /
 * AI inputs. The live document is untouched (the overlay keeps showing on screen); when
 * there is no overlay the document itself is returned.
 */
export function withoutDiffOverlays(doc: Document): Document {
  if (!doc.layers.some(isDiffOverlayLayer)) return doc;
  const layers = doc.layers.filter((l) => !isDiffOverlayLayer(l));
  const active = doc.activeLayerId && layers.some((l) => l.id === doc.activeLayerId) ? doc.activeLayerId : (layers[layers.length - 1]?.id ?? null);
  return { ...doc, layers, activeLayerId: active };
}

/**
 * Compute `composite(with result layer hidden)` vs `composite(with it visible)` and show
 * the difference. Returns the overlay info, or null when toggled off / layer missing.
 */
export function toggleDiffOverlay(open: OpenDoc, resultLayerId: string): DiffOverlayInfo | null {
  const doc = open.doc;
  const current = diffOverlayFor(doc);
  if (current) {
    removeDiffOverlay(open);
    if (current.forLayerId === resultLayerId) return null;
  }
  const layer = findLayer(doc, resultLayerId);
  if (!layer || layer.kind !== "raster") return null;

  const wasVisible = layer.visible;
  layer.visible = false;
  const before = compositeToRaster(doc);
  layer.visible = true;
  const after = compositeToRaster(doc);
  layer.visible = wasVisible;

  const { overlay, changed, fraction } = diffRasters(before, after);
  const overlayLayer = createRasterLayer(doc, {
    id: `${DIFF_LAYER_PREFIX}${newId("d")}`,
    name: DIFF_LAYER_NAME,
    raster: overlay,
    locked: true,
  });
  doc.layers.push(overlayLayer);
  const info: DiffOverlayInfo = { layerId: overlayLayer.id, forLayerId: resultLayerId, changed, fraction };
  overlays.set(doc.id, info);
  bump(open);
  return info;
}
