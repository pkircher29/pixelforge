/**
 * Pixel-level commands that store dirty-rect snapshots of one layer.
 *
 * Lock enforcement (PLAN-v2 §1): `lock.pixels` / `lock.all` make these commands throw
 * `LayerLockedError` (check `isLayerEditable(layer, "pixels")` before starting a
 * stroke); `lock.transparent` keeps the layer's original alpha (`applyTransparencyLock`).
 */

import { Rect } from "../rect";
import { Raster } from "../raster";
import { getPixelLayer } from "../document";
import { applyTransparencyLock, assertEditable, effectiveLock } from "../locks";
import type { Command, Document, LayerDirtyRegion, LayerId, PixelLayer } from "../types";

/**
 * A brush/eraser/clone stroke (or any in-place edit) on one pixel layer.
 *
 * Typical use: at pointer-down call `PaintCommand.capture(layer, rect)` with a
 * generous rect (or capture the whole layer), paint directly into `layer.raster`, then
 * at pointer-up build the command with `PaintCommand.finish(...)` and push it with
 * `{ alreadyApplied: true }`. `finish` enforces "lock transparent pixels" by restoring
 * the captured alpha into the layer before snapshotting.
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

  /** Copy the layer's pixels inside `rect` (clamped to the layer). Throws `LayerLockedError` when pixels are locked. */
  static capture(layer: PixelLayer, rect?: Rect): { rect: Rect; pixels: Raster } {
    assertEditable(layer, "pixels");
    const r = rect ? Rect.intersect(rect, layer.raster.bounds()) : layer.raster.bounds();
    return { rect: r, pixels: layer.raster.crop(r) };
  }

  /**
   * Build the command from a `capture()` taken before the stroke; the "after" snapshot
   * is read from the layer now. Optionally shrink to `dirty` (raster-space) to save memory.
   * With `lock.transparent` the stroke's alpha is discarded (original alpha restored in
   * the layer and in the snapshot).
   */
  static finish(layer: PixelLayer, captured: { rect: Rect; pixels: Raster }, label = "Paint", dirty?: Rect): PaintCommand {
    let rect = captured.rect;
    let before = captured.pixels;
    if (dirty) {
      const d = Rect.intersect(dirty, captured.rect);
      if (!Rect.isEmpty(d) && !Rect.equals(d, captured.rect)) {
        before = captured.pixels.crop(Rect.translate(d, -captured.rect.x, -captured.rect.y));
        rect = d;
      }
    }
    let after = layer.raster.crop(rect);
    if (effectiveLock(layer).transparent) {
      after = applyTransparencyLock(before, after);
      layer.raster.blit(after, rect.x, rect.y, undefined, { mode: "replace" });
    }
    return new PaintCommand(layer.id, rect, before, after, label);
  }

  do(doc: Document): void {
    const layer = getPixelLayer(doc, this.layerId);
    assertEditable(layer, "pixels");
    layer.raster.blit(this.after, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  undo(doc: Document): void {
    getPixelLayer(doc, this.layerId).raster.blit(this.before, this.rect.x, this.rect.y, undefined, { mode: "replace" });
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
 * and costs nothing until pushed. Honours `lock.pixels` (throws) and
 * `lock.transparent` (keeps the original alpha).
 */
export class ReplaceLayerPixelsCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  readonly rect: Rect;
  private pixels: Raster;
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
  static whole(label: string, layer: PixelLayer, pixels: Raster): ReplaceLayerPixelsCommand {
    return new ReplaceLayerPixelsCommand(label, layer.id, layer.raster.bounds(), pixels);
  }

  do(doc: Document): void {
    const layer = getPixelLayer(doc, this.layerId);
    assertEditable(layer, "pixels");
    if (!this.before) {
      this.before = layer.raster.crop(this.rect);
      if (effectiveLock(layer).transparent) this.pixels = applyTransparencyLock(this.before, this.pixels);
    }
    layer.raster.blit(this.pixels, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  undo(doc: Document): void {
    if (!this.before) return;
    getPixelLayer(doc, this.layerId).raster.blit(this.before, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  byteSize(): number {
    return this.pixels.byteLength() + (this.before ? this.before.byteLength() : 0);
  }

  affected(): readonly LayerDirtyRegion[] {
    return [{ layerId: this.layerId, rect: this.rect }];
  }
}

/**
 * Paint on a layer **mask** (or any document-sized channel raster such as the quick
 * mask / an alpha channel). Same capture/finish protocol as `PaintCommand`, but the
 * target raster is resolved through `resolve(doc)`; the compositor is told the layer
 * changed (masks are read at composite time).
 */
export class PaintMaskCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId | null;
  readonly rect: Rect;
  private readonly before: Raster;
  private readonly after: Raster;
  private readonly resolve: (doc: Document) => Raster | null;

  constructor(target: MaskTarget, rect: Rect, before: Raster, after: Raster, label = "Paint Mask") {
    this.label = label;
    this.layerId = target.kind === "layerMask" ? target.layerId : null;
    this.rect = rect;
    this.before = before;
    this.after = after;
    this.resolve = resolverFor(target);
  }

  static capture(raster: Raster, rect?: Rect): { rect: Rect; pixels: Raster } {
    const r = rect ? Rect.intersect(rect, raster.bounds()) : raster.bounds();
    return { rect: r, pixels: raster.crop(r) };
  }

  static finish(target: MaskTarget, raster: Raster, captured: { rect: Rect; pixels: Raster }, label = "Paint Mask"): PaintMaskCommand {
    return new PaintMaskCommand(target, captured.rect, captured.pixels, raster.crop(captured.rect), label);
  }

  do(doc: Document): void {
    this.resolve(doc)?.blit(this.after, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  undo(doc: Document): void {
    this.resolve(doc)?.blit(this.before, this.rect.x, this.rect.y, undefined, { mode: "replace" });
  }

  byteSize(): number {
    return this.before.byteLength() + this.after.byteLength();
  }

  affected(): readonly LayerDirtyRegion[] {
    return this.layerId ? [{ layerId: this.layerId, rect: this.rect }] : [];
  }
}

/** Where a `PaintMaskCommand` paints. */
export type MaskTarget = { kind: "layerMask"; layerId: LayerId } | { kind: "alphaChannel"; channelId: string } | { kind: "quickMask" };

function resolverFor(t: MaskTarget): (doc: Document) => Raster | null {
  switch (t.kind) {
    case "layerMask":
      return (doc) => doc.layers.find((l) => l.id === t.layerId)?.mask ?? null;
    case "alphaChannel":
      return (doc) => doc.alphaChannels.find((c) => c.id === t.channelId)?.mask ?? null;
    case "quickMask":
      return (doc) => doc.quickMask.raster;
  }
}
