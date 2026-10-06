/**
 * Apply an op to the active raster layer as one undoable step (used by instant ops and
 * "Last Filter"; the dialog does the same after its live preview).
 */

import { ReplaceLayerPixelsCommand, Rect } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { applyOp } from "./apply";
import { recordLastFilter } from "./lastFilter";
import { rawDoc, rawRasterLayer } from "./raw";
import type { OpDef, ParamValues } from "./types";

export function activeRasterLayerOk(): boolean {
  const l = docStore.activeLayer;
  return !!l && l.kind === "raster" && !l.locked;
}

/** Returns false when there is no active raster layer or nothing is selected. */
export function applyOpToActiveLayer(op: OpDef, params: ParamValues, label = op.label): boolean {
  const entry = docStore.active;
  const active = docStore.activeLayer;
  const layer = entry && active ? rawRasterLayer(entry, active.id) : null;
  if (!entry || !layer) return false;
  const { raster, dirtyRect } = applyOp(op, layer.raster, params, rawDoc(entry).selection, { offset: layer.offset });
  if (Rect.isEmpty(dirtyRect)) return false;
  docStore.exec(new ReplaceLayerPixelsCommand(label, layer.id, dirtyRect, raster));
  recordLastFilter(op, params);
  return true;
}
