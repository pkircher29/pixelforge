/**
 * Whole-layer transforms (Free Transform, flip, rotate 90) swap the raster and offset.
 */

import type { Point } from "../rect";
import type { Raster } from "../raster";
import { getRasterLayer } from "../document";
import type { Command, Document, LayerId } from "../types";

export class TransformLayerCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private readonly nextRaster: Raster;
  private readonly nextOffset: Point;
  private prev: { raster: Raster; offset: Point } | null = null;

  constructor(layerId: LayerId, raster: Raster, offset: Point, label = "Free Transform") {
    this.layerId = layerId;
    this.nextRaster = raster;
    this.nextOffset = { x: offset.x, y: offset.y };
    this.label = label;
  }

  do(doc: Document): void {
    const layer = getRasterLayer(doc, this.layerId);
    if (!this.prev) this.prev = { raster: layer.raster, offset: { ...layer.offset } };
    layer.raster = this.nextRaster;
    layer.offset = { ...this.nextOffset };
    doc.dirty = true;
  }

  undo(doc: Document): void {
    if (!this.prev) return;
    const layer = getRasterLayer(doc, this.layerId);
    layer.raster = this.prev.raster;
    layer.offset = { ...this.prev.offset };
    doc.dirty = true;
  }

  byteSize(): number {
    return this.nextRaster.byteLength() + (this.prev ? this.prev.raster.byteLength() : 0);
  }
}

/** Flip a layer horizontally or vertically (in its own raster space). */
export function flipLayerCommand(doc: Document, layerId: LayerId, axis: "h" | "v"): TransformLayerCommand {
  const layer = getRasterLayer(doc, layerId);
  const r = axis === "h" ? layer.raster.flipH() : layer.raster.flipV();
  return new TransformLayerCommand(layerId, r, layer.offset, axis === "h" ? "Flip Horizontal" : "Flip Vertical");
}

/** Rotate a layer by 90 degrees around its own centre. */
export function rotateLayer90Command(doc: Document, layerId: LayerId, cw: boolean): TransformLayerCommand {
  const layer = getRasterLayer(doc, layerId);
  const r = layer.raster.rotate90(cw);
  const cx = layer.offset.x + layer.raster.width / 2;
  const cy = layer.offset.y + layer.raster.height / 2;
  const offset = { x: Math.round(cx - r.width / 2), y: Math.round(cy - r.height / 2) };
  return new TransformLayerCommand(layerId, r, offset, cw ? "Rotate 90 CW" : "Rotate 90 CCW");
}
