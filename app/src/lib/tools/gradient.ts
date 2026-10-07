/** Gradient (G): drag a line to fill the layer / selection / mask with the chosen gradient. */
import { Rainbow } from "@lucide/svelte";
import { BLEND_MODE_LABEL, BLEND_MODES, BlendMode, Rect, type GradientStyle, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { constrainAngle } from "./brush-engine";
import { resolvePaintTarget } from "./paint-target";
import { paintGradient } from "./gradient-paint";
import { parseGradient, toEngineGradient, type GradientDef } from "./gradient-model";
import { DEFAULT_GRADIENTS, gradientById, loadUserGradients } from "./gradient-presets";

export const GRADIENT_STYLE_ITEMS = [
  { value: "linear", icon: "gradient", title: "Linear Gradient" },
  { value: "radial", icon: "marquee-ellipse", title: "Radial Gradient" },
  { value: "angle", icon: "clock", title: "Angle Gradient" },
  { value: "reflected", icon: "distribute-h", title: "Reflected Gradient" },
  { value: "diamond", icon: "kind-shape", title: "Diamond Gradient" },
] as const;

/** Resolve the tool's gradient option (preset id or serialized def). */
export function currentGradient(value: string): GradientDef {
  return parseGradient(value) ?? gradientById(value, loadUserGradients()) ?? DEFAULT_GRADIENTS[0]!;
}

export class GradientTool implements Tool {
  readonly id = "gradient";
  readonly name = "Gradient";
  readonly icon = Rainbow;
  readonly shortcut = "g";
  readonly group = "gradient";
  readonly groupOrder = 0;
  readonly cursor = "crosshair";
  readonly hint = "Drag to fill with the gradient. Shift constrains the angle. Click the gradient preview to open the editor.";
  readonly options: readonly ToolOption[] = [
    { kind: "custom", key: "gradient", renderer: "gradient-picker", label: "", default: "fg-bg" },
    { kind: "custom", key: "style", renderer: "icon-select", label: "", default: "linear", props: { items: GRADIENT_STYLE_ITEMS } },
    { kind: "select", key: "mode", label: "Mode", choices: BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] })), default: BlendMode.Normal },
    { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" },
    { kind: "toggle", key: "reverse", label: "Reverse", default: false },
    { kind: "toggle", key: "dither", label: "Dither", default: true },
    { kind: "toggle", key: "transparency", label: "Transparency", default: true },
  ];

  private anchor: Point | null = null;
  private cur: Point | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (!resolvePaintTarget(ctx, "fill")) return;
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
    const target = resolvePaintTarget(ctx, "fill");
    if (!target) return;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) b = { x: a.x + 1, y: a.y };
    const sel = ctx.doc.selection;
    let rect = target.raster.bounds();
    if (!sel.isEmpty) rect = Rect.intersect(Rect.translate(sel.bbox!, -target.offset.x, -target.offset.y), rect);
    if (Rect.isEmpty(rect)) return;
    let captured: { rect: Rect; pixels: import("$lib/engine").Raster };
    try {
      captured = target.capture();
    } catch (err) {
      ctx.notify("info", (err as Error).message);
      return;
    }
    const def = currentGradient(ctx.opt<string>("gradient"));
    let gradient = toEngineGradient(def, ctx.fg(), ctx.bg());
    if (target.isMask) {
      gradient = { stops: gradient.stops.map((s) => {
        const l = Math.round(0.299 * s.color.r + 0.587 * s.color.g + 0.114 * s.color.b);
        return { pos: s.pos, color: { r: l, g: l, b: l, a: s.color.a } };
      }) };
    }
    const touched = paintGradient(target.raster, { x: a.x - target.offset.x, y: a.y - target.offset.y }, { x: b.x - target.offset.x, y: b.y - target.offset.y }, gradient, {
      style: ctx.opt<string>("style") as GradientStyle,
      reverse: ctx.opt<boolean>("reverse"),
      dither: ctx.opt<boolean>("dither"),
      transparency: ctx.opt<boolean>("transparency"),
      opacity: ctx.opt<number>("opacity") / 100,
      mode: (ctx.opt<string>("mode") || BlendMode.Normal) as BlendMode,
      clip: sel,
      offset: target.offset,
    });
    if (!touched) return;
    const cmd = target.finish(captured, "Gradient", touched);
    if (cmd) ctx.exec(cmd, { alreadyApplied: true, noMerge: true });
    ctx.touch({ layerId: target.dirtyId, rect: touched });
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
      g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      g.fillStyle = "#1473e6";
      g.fill();
      g.stroke();
    }
    g.restore();
  }
}
