/**
 * Whole-document state capture for history snapshots and `SnapshotCommand`. A captured
 * state is fully independent of the live document (rasters cloned) so it can be
 * restored any number of times.
 */

import { Raster } from "./raster";
import { Selection } from "./selection";
import { cloneLayer } from "./document";
import type { AlphaChannel, Document, Layer, LayerId, Path } from "./types";
import { clonePath } from "./ops/vector";

export interface DocState {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: LayerId | null;
  selection: Selection;
  alphaChannels: AlphaChannel[];
  paths: Path[];
  workPathId: string | null;
  bytes: number;
}

/** Deep copy of everything a snapshot restores. */
export function captureDocState(doc: Document): DocState {
  const idMap = new Map<LayerId, LayerId>();
  const layers = doc.layers.map((l) => {
    const c = cloneLayer(l, l.id, l.name);
    c.linkedTo = l.linkedTo.slice();
    idMap.set(l.id, c.id);
    return c;
  });
  let bytes = doc.selection.byteLength();
  for (const l of layers) {
    if (l.kind === "raster" || l.kind === "shape" || l.kind === "text") bytes += l.raster.byteLength();
    if (l.mask) bytes += l.mask.byteLength();
  }
  const alphaChannels = doc.alphaChannels.map((c) => ({ ...c, color: { ...c.color }, mask: c.mask.clone() }));
  for (const c of alphaChannels) bytes += c.mask.byteLength();
  return {
    width: doc.width,
    height: doc.height,
    layers,
    activeLayerId: doc.activeLayerId,
    selection: doc.selection.clone(),
    alphaChannels,
    paths: doc.paths.map(clonePath),
    workPathId: doc.workPathId,
    bytes,
  };
}

/** Replace the document's content with a (cloned) copy of `state`. */
export function restoreDocState(doc: Document, state: DocState): void {
  const copy = captureDocState({ ...doc, ...state } as Document);
  doc.width = copy.width;
  doc.height = copy.height;
  doc.layers = copy.layers;
  doc.activeLayerId = copy.activeLayerId;
  doc.selection = copy.selection;
  doc.alphaChannels = copy.alphaChannels;
  doc.paths = copy.paths;
  doc.workPathId = copy.workPathId;
  doc.dirty = true;
}

/** Raster of a layer in a captured state (cloned), or null. */
export function stateLayerRaster(state: DocState, layerId: LayerId): Raster | null {
  const l = state.layers.find((x) => x.id === layerId);
  if (!l || !(l.kind === "raster" || l.kind === "shape" || l.kind === "text")) return null;
  return l.raster.clone();
}
