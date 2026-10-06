/** Gradient (Shift+G): drag a line to fill the layer (or selection) foreground → background. */
import { Rainbow } from "@lucide/svelte";
import { PaintCommand, Rect, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { renderGradient, type GradientType } from "./paint/fill";
import { constrainAngle } from "./paint/dab";
import { paintableLayer, toLayerSpace } from "./util";

export class GradientTool implements Tool {
  readonly id = "gradient";
  readonly name = "Gradient";
  readonly icon = Rainbow;
  readonly shortcut = "Shift+g";
  readonly group = "fill";
  readonly cursor = "crosshair";
  readonly hint = "Drag from the foreground colour to the background colour. Shift constrains the angle.";
  readonly options: readonly ToolOption[] = [
    {
      kind: "select",
      key: "type",
      label: "Type",
      choices: [
        { value: "linear", label: "Linear" },
        { value: "radial", label: "Radial" },
      ],
      default: "linear",
    },
    { kind: "toggle", key: "reverse", label: "Reverse", default: false },
    { kind: "toggle", key: "dither", label: "Dither", default: true },
    { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" },
    { kind: "color", key: "fg", label: "From" },
    { kind: "color", key: "bg", label: "To" },
  ];

  private anchor: Point | null = null;
  private cur: Point | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (!paintableLayer(ctx, "fill")) return;
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.anchor) return;
    let p = { x: e.x, y: e.y };
    if (e.shiftKey) p = constrainAngle(this.anchor, p);
    this.cur = p;
    ctx.invalidateOverlay();
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const a = this.anchor;
    if (!a) return;
    let b = { x: e.x, y: e.y };
    if (e.shiftKey) b = constrainAngle(a, b);
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
    const layer = paintableLayer(ctx, "fill");
    if (!layer) return;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) b = { x: a.x + 1, y: a.y };
    const sel = ctx.doc.selection;
    let rect = layer.raster.bounds();
    if (!sel.isEmpty) rect = Rect.intersect(Rect.translate(sel.bbox!, -layer.offset.x, -layer.offset.y), rect);
    if (Rect.isEmpty(rect)) return;
    const captured = PaintCommand.capture(layer, rect);
    const reverse = ctx.opt<boolean>("reverse");
    const c0 = reverse ? ctx.bg() : ctx.fg();
    const c1 = reverse ? ctx.fg() : ctx.bg();
    const touched = renderGradient(layer.raster, toLayerSpace(layer, a), toLayerSpace(layer, b), c0, c1, ctx.opt<GradientType>("type"), {
      clip: sel,
      offset: layer.offset,
      opacity: ctx.opt<number>("opacity") / 100,
      dither: ctx.opt<boolean>("dither"),
    });
    if (!touched) return;
    ctx.exec(PaintCommand.finish(layer, captured, "Gradient", touched), { alreadyApplied: true, noMerge: true });
  }

  cancel(ctx: ToolContext): void {
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.anchor || !this.cur) return;
    const a = ctx.viewport.docToScreen(this.anchor);
    const b = ctx.viewport.docToScreen(this.cur);
    g.save();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = "#fff";
    g.stroke();
    for (const p of [a, b]) {
      g.beginPath();
      g.arc(p.x, p.y, 4, 0, Math.PI * 2);
      g.fillStyle = "#8b6cff";
      g.fill();
      g.stroke();
    }
    g.restore();
  }
}
