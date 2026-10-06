/** Paint Bucket (G): flood-fill similar colours, or fill the selection when one exists. */
import { PaintBucket } from "@lucide/svelte";
import { PaintCommand, Rect, Selection, compositeToRaster } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { fillThroughMask } from "./paint/fill";
import { paintableLayer } from "./util";

export class BucketTool implements Tool {
  readonly id = "bucket";
  readonly name = "Paint Bucket";
  readonly icon = PaintBucket;
  readonly shortcut = "g";
  readonly group = "fill";
  readonly cursor = "crosshair";
  readonly hint = "Click to fill similar colours with the foreground colour. With a selection, the selection is filled.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "tolerance", label: "Tolerance", min: 0, max: 255, step: 1, default: 32 },
    { kind: "toggle", key: "contiguous", label: "Contiguous", default: true },
    { kind: "toggle", key: "sampleMerged", label: "Sample all layers", default: false },
    { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" },
    { kind: "color", key: "fg", label: "Colour" },
  ];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const layer = paintableLayer(ctx, "fill");
    if (!layer) return;
    const doc = ctx.doc;
    const px = Math.floor(e.x);
    const py = Math.floor(e.y);
    if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return;
    let mask: Selection;
    if (!doc.selection.isEmpty) {
      mask = doc.selection;
    } else {
      const tol = ctx.opt<number>("tolerance");
      const contiguous = ctx.opt<boolean>("contiguous");
      if (ctx.opt<boolean>("sampleMerged")) {
        mask = Selection.fromMagicWand(compositeToRaster(doc), px, py, tol, contiguous);
      } else {
        const lx = px - layer.offset.x;
        const ly = py - layer.offset.y;
        if (lx < 0 || ly < 0 || lx >= layer.raster.width || ly >= layer.raster.height) return;
        mask = Selection.fromMagicWand(layer.raster, lx, ly, tol, contiguous, {
          size: { w: doc.width, h: doc.height },
          offset: layer.offset,
        });
      }
    }
    const bb = mask.bbox;
    if (!bb) return;
    const target = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
    if (Rect.isEmpty(target)) return;
    const captured = PaintCommand.capture(layer, target);
    const touched = fillThroughMask(layer.raster, mask, layer.offset, e.altKey ? ctx.bg() : ctx.fg(), ctx.opt<number>("opacity") / 100);
    if (!touched) return;
    ctx.exec(PaintCommand.finish(layer, captured, "Paint Bucket", touched), { alreadyApplied: true, noMerge: true });
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}
