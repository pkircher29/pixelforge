/**
 * Layer lock enforcement (PLAN-v2 §1). Commands call `assertEditable` and throw
 * `LayerLockedError`; the UI calls `isLayerEditable` to grey out tools and show a toast.
 */

import { Raster } from "./raster";
import type { Layer, LayerId, LayerLock } from "./types";

/** What an operation wants to do to a layer. */
export type LayerEditOp = "pixels" | "position" | "transparent" | "structure" | "props";

export class LayerLockedError extends Error {
  readonly layerId: LayerId;
  readonly layerName: string;
  readonly op: LayerEditOp;
  readonly lock: LayerLock;

  constructor(layer: Layer, op: LayerEditOp) {
    super(`"${layer.name}" is locked (${op})`);
    this.name = "LayerLockedError";
    this.layerId = layer.id;
    this.layerName = layer.name;
    this.op = op;
    this.lock = { ...layer.lock };
  }
}

/** Effective lock flags (`locked` legacy flag counts as `all`). */
export function effectiveLock(layer: Layer): LayerLock {
  const all = layer.lock.all || layer.locked;
  return {
    all,
    pixels: all || layer.lock.pixels,
    position: all || layer.lock.position,
    transparent: all || layer.lock.transparent,
  };
}

/**
 * True when `op` may proceed on the layer:
 * - `pixels`: painting, filters, pixel replacement — refused by `pixels` / `all`
 * - `position`: move / transform — refused by `position` / `all`
 * - `transparent`: painting into transparent areas — refused by `transparent` (paint
 *   ops should instead keep the original alpha; see `applyTransparencyLock`)
 * - `structure`: delete / merge / reorder — refused by `all`
 * - `props`: visibility, opacity, blend, name — never refused
 */
export function isLayerEditable(layer: Layer, op: LayerEditOp): boolean {
  const l = effectiveLock(layer);
  switch (op) {
    case "pixels":
      return !l.pixels;
    case "position":
      return !l.position;
    case "transparent":
      return !l.transparent;
    case "structure":
      return !l.all;
    case "props":
      return true;
  }
}

/** Throw `LayerLockedError` unless the op is allowed. */
export function assertEditable(layer: Layer, op: LayerEditOp): void {
  if (!isLayerEditable(layer, op)) throw new LayerLockedError(layer, op);
}

/**
 * Enforce "Lock transparent pixels": every pixel of `after` keeps the alpha it had in
 * `before` (color from `after` where `before` had any alpha). Both rasters must be the
 * same size; returns a new raster.
 */
export function applyTransparencyLock(before: Raster, after: Raster): Raster {
  if (before.width !== after.width || before.height !== after.height) throw new RangeError("applyTransparencyLock: size mismatch");
  const out = after.clone();
  const b = before.data;
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const ba = b[i + 3]!;
    if (ba === 0) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    d[i + 3] = ba;
  }
  return out;
}
