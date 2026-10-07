/** Clone Stamp (S), Pattern Stamp and History Brush (Y) — "source" strokes. */
import { Clock as History, Stamp, Grid3x3 } from "@lucide/svelte";
import type { Point } from "$lib/engine";
import { toolStore } from "$lib/stores/tool.svelte";
import type { ToolContext, ToolEvent } from "./types";
import type { StrokeBlend } from "./brush-engine";
import { AIRBRUSH_OPTION, BRUSH_PICKER_OPTION, BrushBasedTool, FLOW_OPTION, OPACITY_OPTION, SAMPLE_OPTION } from "./brush-base";
import type { PaintTarget } from "./paint-target";
import { patternById } from "./patterns";

export class CloneStampTool extends BrushBasedTool {
  private source: Point | null = null;
  private delta: Point | null = null;

  constructor() {
    super({
      id: "clone",
      name: "Clone Stamp",
      icon: Stamp,
      shortcut: "s",
      group: "stamp",
      groupOrder: 0,
      hint: "Alt-click to set the source, then paint. Aligned keeps the offset between strokes.",
      label: "Clone Stamp",
      options: [BRUSH_PICKER_OPTION, OPACITY_OPTION, FLOW_OPTION, AIRBRUSH_OPTION, { kind: "toggle", key: "aligned", label: "Aligned", default: true }, SAMPLE_OPTION],
    });
  }

  protected override onAltClick(e: ToolEvent, ctx: ToolContext): boolean {
    this.source = { x: e.x, y: e.y };
    this.delta = null;
    ctx.hint(`Clone source set at ${Math.round(e.x)}, ${Math.round(e.y)}`);
    ctx.invalidateOverlay();
    return true;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    if (!this.source) {
      ctx.notify("info", "Alt-click to set a clone source first.");
      return null;
    }
    const aligned = ctx.opt<boolean>("aligned");
    if (!aligned || !this.delta) this.delta = { x: this.source.x - e.x, y: this.source.y - e.y };
    const delta = this.delta;
    const { raster, offset } = this.sourceRaster(ctx, target, ctx.opt<string>("sample") === "all");
    // Layer px (x,y) ↔ doc (x + target.offset); source doc px = p_doc + delta → source raster px = that - offset.
    const dx = Math.round(delta.x + target.offset.x - offset.x);
    const dy = Math.round(delta.y + target.offset.y - offset.y);
    const isMask = target.isMask;
    return {
      mode: "source",
      sourceAt: (x, y, out) => {
        raster.getPixel(x + dx, y + dy, out);
        if (isMask) {
          const v = 0.299 * out.r + 0.587 * out.g + 0.114 * out.b;
          out.r = out.g = out.b = v;
        }
      },
    };
  }

  protected override drawExtraOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const src = this.source;
    if (!src) return;
    let p = src;
    if (this.stroke && this.delta && this.hover) p = { x: this.hover.x + this.delta.x, y: this.hover.y + this.delta.y };
    const s = ctx.viewport.docToScreen(p);
    g.save();
    g.strokeStyle = "#1473e6";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(s.x - 7, s.y);
    g.lineTo(s.x + 7, s.y);
    g.moveTo(s.x, s.y - 7);
    g.lineTo(s.x, s.y + 7);
    g.stroke();
    g.beginPath();
    g.arc(s.x, s.y, 4, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

}

export class PatternStampTool extends BrushBasedTool {
  private start: Point | null = null;

  constructor() {
    super({
      id: "pattern-stamp",
      name: "Pattern Stamp",
      icon: Grid3x3,
      shortcut: "s",
      group: "stamp",
      groupOrder: 1,
      hint: "Paint with the chosen pattern. Aligned keeps the tiling fixed to the document.",
      label: "Pattern Stamp",
      options: [
        BRUSH_PICKER_OPTION,
        OPACITY_OPTION,
        FLOW_OPTION,
        AIRBRUSH_OPTION,
        { kind: "custom", key: "pattern", renderer: "pattern-picker", label: "Pattern", default: "checker" },
        { kind: "toggle", key: "aligned", label: "Aligned", default: true },
        { kind: "number", key: "scale", label: "Scale", min: 10, max: 400, step: 1, default: 100, unit: "%" },
      ],
    });
  }

  protected override onAltClick(): boolean {
    return false;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    const pat = patternById(ctx.opt<string>("pattern")).raster;
    const scale = Math.max(0.1, ctx.opt<number>("scale") / 100);
    const aligned = ctx.opt<boolean>("aligned");
    this.start = aligned ? { x: 0, y: 0 } : { x: Math.floor(e.x - target.offset.x), y: Math.floor(e.y - target.offset.y) };
    const ox = this.start.x - target.offset.x * (aligned ? 1 : 0);
    const oy = this.start.y - target.offset.y * (aligned ? 1 : 0);
    const pw = pat.width;
    const ph = pat.height;
    const isMask = target.isMask;
    return {
      mode: "source",
      sourceAt: (x, y, out) => {
        const u = Math.floor((x - ox) / scale);
        const v = Math.floor((y - oy) / scale);
        pat.getPixel(((u % pw) + pw) % pw, ((v % ph) + ph) % ph, out);
        if (isMask) {
          const l = 0.299 * out.r + 0.587 * out.g + 0.114 * out.b;
          out.r = out.g = out.b = l;
        }
      },
    };
  }
}

export class HistoryBrushTool extends BrushBasedTool {
  constructor() {
    super({
      id: "history-brush",
      name: "History Brush",
      icon: History,
      shortcut: "y",
      group: "history",
      groupOrder: 0,
      hint: "Paints the layer as it was at the history source (set it in the History panel; default: first state).",
      label: "History Brush",
      options: [BRUSH_PICKER_OPTION, OPACITY_OPTION, FLOW_OPTION, AIRBRUSH_OPTION],
    });
  }

  protected override onAltClick(): boolean {
    return false;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget): StrokeBlend | null {
    if (!target.layerId || target.kind !== "layer") {
      ctx.notify("info", "The History Brush paints pixel layers.");
      return null;
    }
    const source = toolStore.historySource ?? { kind: "state", index: 0 };
    const src = ctx.history.rasterFromSource(source, target.layerId);
    if (!src) {
      ctx.notify("info", "The history source does not contain this layer. Pick another source in the History panel.");
      return null;
    }
    return { mode: "source", sourceAt: (x, y, out) => src.getPixel(x, y, out) };
  }
}
