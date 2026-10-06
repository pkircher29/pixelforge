/**
 * Pixel-level commands that store dirty-rect snapshots of one layer.
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import { getRasterLayer } from "../document";
import type { Command, Document, LayerDirtyRegion, LayerId, RasterLayer } from "../types";

/**
 * A brush/eraser/clone stroke (or any in-place edit) on one raster layer.
 *
 * Typical use: at pointer-down call `PaintCommand.capture(layer, rect)` with a
 * generous rect (or capture the whole layer), paint directly into `layer.raster`, then
 * at pointer-up build the command with `PaintCommand.finish(...)` and push it with
 * `{ alreadyApplied: true }`.
 */
export class PaintCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  /** Raster-space rect of the layer that both snapshots cover. */
  readonly rect: Rect;
  private readonly before: Raster;
  private readonly after: Raster;

  constructor(layerId: LayerId, rect: Rect, before: Raster, after: Raster, label = "Paint") {
    if (before.width !== rect.w || before.height !== rect.h || after.width !== rect.w || after.height !== rect.h) {
      throw new RangeError("PaintCommand: snapshots must match rect size");
    }
    this.label = label;
    this.layerId = layerId;
    this.rect = rect;
    this.before = before;
    this.after = after;
  }

  /** Copy the layer's pixels inside `rect` (clamped to the layer). */
  static capture(layer: RasterLayer, rect?: Rect): { rect: Rect; pixels: Raster } {
    const r = rect ? Rect.intersect(rect, layer.raster.bounds()) : layer.raster.bounds();
    return { rect: r, pixels: layer.raster.crop(r) };
  }

  /**
   * Build the command from a `capture()` taken before the stroke; the "after" snapshot
   * is read from the layer now. Optionally shrink to `dirty` (raster-space) to save memory.
   */
  static finish(
    layer: RasterLayer,
    captured: { rect: Rect; pixels: Raster },
    label = "Paint",
    dirty?: Rect,
  ): PaintCommand {
    let rect = captured.rect;
    let before = captured.pixels;
    if (dirty) {
      const d = Rect.intersect(dirty, captured.rect);
      if (!Rect.isEmpty(d) && !Rect.equals(d, captured.rect)) {
        before = captured.pixels.crop(Rect.translate(d, -captured.rect.x, -captured.rect.y));
        rect = d;
      }
    }
    const after = layer.raster.crop(rect);
    return new PaintCommand(layer.id, rect, before, after, label);
  }

  do(doc: Document): void {
    getRasterLayer(doc, this.layerId).raster.blit(this.after, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  undo(doc: Document): void {
    getRasterLayer(doc, this.layerId).raster.blit(this.before, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  byteSize(): number {
    return this.before.byteLength() + this.after.byteLength();
  }

  affected(): readonly LayerDirtyRegion[] {
    return [{ layerId: this.layerId, rect: this.rect }];
  }
}

/**
 * Replace the pixels of a layer inside `rect` with `pixels` (filters / adjustments).
 * The "before" snapshot is taken lazily on the first `do`, so it is dirty-rect aware
 * and costs nothing until pushed.
 */
export class ReplaceLayerPixelsCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  readonly rect: Rect;
  private readonly pixels: Raster;
  private before: Raster | null = null;

  /** `pixels` must be `rect.w x rect.h`. */
  constructor(label: string, layerId: LayerId, rect: Rect, pixels: Raster) {
    if (pixels.width !== rect.w || pixels.height !== rect.h) {
      throw new RangeError("ReplaceLayerPixelsCommand: pixels must match rect size");
    }
    this.label = label;
    this.layerId = layerId;
    this.rect = rect;
    this.pixels = pixels;
  }

  /** Convenience: replace the whole layer with a same-size raster. */
  static whole(label: string, layer: RasterLayer, pixels: Raster): ReplaceLayerPixelsCommand {
    return new ReplaceLayerPixelsCommand(label, layer.id, layer.raster.bounds(), pixels);
  }

  do(doc: Document): void {
    const layer = getRasterLayer(doc, this.layerId);
    if (!this.before) this.before = layer.raster.crop(this.rect);
    layer.raster.blit(this.pixels, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  undo(doc: Document): void {
    if (!this.before) return;
    getRasterLayer(doc, this.layerId).raster.blit(this.before, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  byteSize(): number {
    return this.pixels.byteLength() + (this.before ? this.before.byteLength() : 0);
  }

  affected(): readonly LayerDirtyRegion[] {
    return [{ layerId: this.layerId, rect: this.rect }];
  }
}
