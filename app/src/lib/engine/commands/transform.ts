/**
 * Whole-layer transforms (Free Transform, flip, rotate 90) swap the raster and offset.
 * Refused (`LayerLockedError`) by `lock.position` / `lock.all`.
 */

import type { Point } from "../rect";
import { Raster } from "../raster";
import { getPixelLayer } from "../document";
import { assertEditable } from "../locks";
import type { Command, Document, LayerId } from "../types";

export class TransformLayerCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private readonly nextRaster: Raster;
  private readonly nextOffset: Point;
  private readonly nextMask: Raster | null | undefined;
  private prev: { raster: Raster; offset: Point; mask: Raster | null } | null = null;

  /** `mask`: transformed mask to install alongside (undefined = keep the current mask object). */
  constructor(layerId: LayerId, raster: Raster, offset: Point, label = "Free Transform", mask?: Raster | null) {
    this.layerId = layerId;
    this.nextRaster = raster;
    this.nextOffset = { x: offset.x, y: offset.y };
    this.nextMask = mask;
    this.label = label;
  }

  do(doc: Document): void {
    const layer = getPixelLayer(doc, this.layerId);
    assertEditable(layer, "position");
    if (!this.prev) this.prev = { raster: layer.raster, offset: { ...layer.offset }, mask: layer.mask };
    layer.raster = this.nextRaster;
    layer.offset = { ...this.nextOffset };
    if (this.nextMask !== undefined) layer.mask = this.nextMask;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    if (!this.prev) return;
    const layer = getPixelLayer(doc, this.layerId);
    layer.raster = this.prev.raster;
    layer.offset = { ...this.prev.offset };
    layer.mask = this.prev.mask;
    doc.dirty = true;
  }

  byteSize(): number {
    return this.nextRaster.byteLength() + (this.prev ? this.prev.raster.byteLength() : 0);
  }
}

/** Flip a layer horizontally or vertically (in its own raster space); the mask flips along when linked. */
export function flipLayerCommand(doc: Document, layerId: LayerId, axis: "h" | "v"): TransformLayerCommand {
  const layer = getPixelLayer(doc, layerId);
  const r = axis === "h" ? layer.raster.flipH() : layer.raster.flipV();
  const m = layer.mask && layer.maskLinked ? (axis === "h" ? layer.mask.flipH() : layer.mask.flipV()) : undefined;
  return new TransformLayerCommand(layerId, r, layer.offset, axis === "h" ? "Flip Horizontal" : "Flip Vertical", m);
}

/** Rotate a layer by 90 degrees around its own centre. */
export function rotateLayer90Command(doc: Document, layerId: LayerId, cw: boolean): TransformLayerCommand {
  const layer = getPixelLayer(doc, layerId);
  const r = layer.raster.rotate90(cw);
  const cx = layer.offset.x + layer.raster.width / 2;
  const cy = layer.offset.y + layer.raster.height / 2;
  const offset = { x: Math.round(cx - r.width / 2), y: Math.round(cy - r.height / 2) };
  const m = layer.mask && layer.maskLinked ? layer.mask.rotate90(cw) : layer.mask ? null : undefined;
  return new TransformLayerCommand(layerId, r, offset, cw ? "Rotate 90 CW" : "Rotate 90 CCW", m);
}
