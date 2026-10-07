/**
 * Where a paint tool writes: the active pixel layer, its mask (when the mask thumbnail
 * is targeted) or the quick mask. Resolves locks / visibility with a toast and builds
 * the matching undo command (`PaintCommand` / `PaintMaskCommand`).
 */
import {
  PaintCommand,
  PaintMaskCommand,
  Raster,
  Rect,
  activeLayer,
  effectiveLock,
  isLayerEditable,
  type Command,
  type Layer,
  type LayerId,
  type Point,
  type RasterLayer,
} from "$lib/engine";
import { toolStore } from "$lib/stores/tool.svelte";
import type { ToolContext } from "./types";

export interface PaintTarget {
  kind: "layer" | "layerMask" | "quickMask";
  layer: Layer | null;
  layerId: LayerId | null;
  /** The raster being painted. */
  raster: Raster;
  /** Document offset of `raster`. */
  offset: Point;
  /** Id passed to `ctx.touch` / `markDirty`. */
  dirtyId: string;
  /** True for gray channel rasters (masks): colours are converted to luminance. */
  isMask: boolean;
  /** Snapshot for undo. */
  capture(): { rect: Rect; pixels: Raster };
  /** Undo command after painting (null when nothing changed). */
  finish(captured: { rect: Rect; pixels: Raster }, label: string, dirty: Rect | null): Command | null;
}

/** Human reason a layer can't be painted, or null. */
export function lockReason(layer: Layer, op: "pixels" | "position" = "pixels"): string | null {
  if (isLayerEditable(layer, op)) return null;
  const l = effectiveLock(layer);
  if (l.all) return `"${layer.name}" is locked (all). Unlock it in the Layers panel.`;
  if (op === "pixels" && l.pixels) return `"${layer.name}" has locked image pixels.`;
  if (op === "position" && l.position) return `"${layer.name}" has a locked position.`;
  return `"${layer.name}" is locked.`;
}

/**
 * Resolve the paint target for the active document. `action` is used in messages
 * ("paint", "erase"…). Returns null (after a toast) when nothing can be painted.
 */
export function resolvePaintTarget(ctx: ToolContext, action = "paint"): PaintTarget | null {
  const doc = ctx.doc;
  if (doc.quickMask.active && doc.quickMask.raster) {
    const raster = doc.quickMask.raster;
    return {
      kind: "quickMask",
      layer: null,
      layerId: null,
      raster,
      offset: { x: 0, y: 0 },
      dirtyId: "@quickmask",
      isMask: true,
      capture: () => PaintMaskCommand.capture(raster),
      finish: (captured, label, dirty) => {
        if (!dirty) return null;
        const r = Rect.intersect(dirty, captured.rect);
        if (Rect.isEmpty(r)) return null;
        const before = captured.pixels.crop(Rect.translate(r, -captured.rect.x, -captured.rect.y));
        return new PaintMaskCommand({ kind: "quickMask" }, r, before, raster.crop(r), label);
      },
    };
  }
  const layer = activeLayer(doc);
  if (!layer) {
    ctx.notify("info", "Add a layer first.");
    return null;
  }
  if (toolStore.maskTarget && layer.mask) {
    if (!isLayerEditable(layer, "pixels") && effectiveLock(layer).all) {
      ctx.notify("info", lockReason(layer) ?? "Layer is locked.");
      return null;
    }
    const mask = layer.mask;
    const isPixel = layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text";
    const offset = isPixel ? { ...layer.offset } : { x: 0, y: 0 };
    const id = layer.id;
    return {
      kind: "layerMask",
      layer,
      layerId: id,
      raster: mask,
      offset,
      dirtyId: id,
      isMask: true,
      capture: () => PaintMaskCommand.capture(mask),
      finish: (captured, label, dirty) => {
        if (!dirty) return null;
        const r = Rect.intersect(dirty, captured.rect);
        if (Rect.isEmpty(r)) return null;
        const before = captured.pixels.crop(Rect.translate(r, -captured.rect.x, -captured.rect.y));
        return new PaintMaskCommand({ kind: "layerMask", layerId: id }, r, before, mask.crop(r), label);
      },
    };
  }
  if (layer.kind === "group") {
    ctx.notify("info", `Select a pixel layer to ${action} — groups hold no pixels.`);
    return null;
  }
  if (layer.kind === "adjustment" || layer.kind === "fill") {
    ctx.notify("info", `"${layer.name}" is a ${layer.kind} layer. Target its mask, or ${action} on a pixel layer.`);
    return null;
  }
  if (layer.kind === "shape" || layer.kind === "text") {
    ctx.notify("info", `"${layer.name}" is a ${layer.kind} layer. Rasterize it (Layer ▸ Rasterize) to ${action} on it.`);
    return null;
  }
  const reason = lockReason(layer, "pixels");
  if (reason) {
    ctx.notify("info", reason);
    return null;
  }
  if (!layer.visible) {
    ctx.notify("info", `"${layer.name}" is hidden. Show it to ${action}.`);
    return null;
  }
  return layerTarget(layer);
}

/** A paint target for a specific raster layer (no checks). */
export function layerTarget(layer: RasterLayer): PaintTarget {
  return {
    kind: "layer",
    layer,
    layerId: layer.id,
    raster: layer.raster,
    offset: { ...layer.offset },
    dirtyId: layer.id,
    isMask: false,
    capture: () => PaintCommand.capture(layer),
    finish: (captured, label, dirty) => (dirty ? PaintCommand.finish(layer, captured, label, dirty) : null),
  };
}

/** Active raster layer when it can be painted (silent), else null. */
export function paintableRasterLayer(ctx: ToolContext): RasterLayer | null {
  const l = activeLayer(ctx.doc);
  if (!l || l.kind !== "raster" || !l.visible || !isLayerEditable(l, "pixels")) return null;
  return l;
}
