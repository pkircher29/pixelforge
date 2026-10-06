/** Brush (B), Eraser (E) and Clone Stamp (S) — one stroke engine, three modes. */
import { Brush, Eraser, Stamp } from "@lucide/svelte";
import { compositeToRaster, type Point, type Raster, type RasterLayer, type RGBA } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { Stroke, type StrokeMode } from "./paint/stroke";
import { constrainAngle, pressureSize } from "./paint/dab";
import { CompositeSampler, paintableLayer, toLayerSpace } from "./util";
import { sampleColor } from "./eyedropper";

const SIZE_OPTION: ToolOption = { kind: "number", key: "size", label: "Size", min: 1, max: 500, step: 1, default: 24, unit: "px", log: true };
const HARDNESS_OPTION: ToolOption = { kind: "number", key: "hardness", label: "Hardness", min: 0, max: 100, step: 1, default: 80, unit: "%" };
const OPACITY_OPTION: ToolOption = { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" };
const FLOW_OPTION: ToolOption = { kind: "number", key: "flow", label: "Flow", min: 1, max: 100, step: 1, default: 100, unit: "%" };
const SPACING_OPTION: ToolOption = { kind: "number", key: "spacing", label: "Spacing", min: 1, max: 200, step: 1, default: 25, unit: "%", slider: false };
const PRESSURE_OPTION: ToolOption = { kind: "toggle", key: "pressureSize", label: "Pen pressure → size", default: true };

export class BrushTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut: string;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  protected readonly mode: StrokeMode;

  private stroke: Stroke | null = null;
  private lastEnd: Point | null = null;
  private hover: { sx: number; sy: number } | null = null;
  private readonly sampler = new CompositeSampler();

  // Clone state.
  private cloneSource: Point | null = null;
  private cloneDelta: Point | null = null;

  constructor(mode: StrokeMode) {
    this.mode = mode;
    if (mode === "paint") {
      this.id = "brush";
      this.name = "Brush";
      this.icon = Brush;
      this.shortcut = "b";
      this.hint = "Drag to paint. Shift-click paints a straight line from the last point; Alt-click samples a colour. [ ] change size.";
      this.options = [SIZE_OPTION, HARDNESS_OPTION, OPACITY_OPTION, FLOW_OPTION, SPACING_OPTION, PRESSURE_OPTION, { kind: "color", key: "fg", label: "Colour" }];
    } else if (mode === "erase") {
      this.id = "eraser";
      this.name = "Eraser";
      this.icon = Eraser;
      this.shortcut = "e";
      this.hint = "Drag to erase to transparency. [ ] change size.";
      this.options = [SIZE_OPTION, HARDNESS_OPTION, OPACITY_OPTION, FLOW_OPTION, SPACING_OPTION, PRESSURE_OPTION];
    } else {
      this.id = "clone";
      this.name = "Clone Stamp";
      this.icon = Stamp;
      this.shortcut = "s";
      this.hint = "Alt-click to set the source, then paint. The source follows your stroke.";
      this.options = [
        SIZE_OPTION,
        HARDNESS_OPTION,
        OPACITY_OPTION,
        FLOW_OPTION,
        SPACING_OPTION,
        PRESSURE_OPTION,
        { kind: "toggle", key: "aligned", label: "Aligned", default: true },
        { kind: "toggle", key: "sampleMerged", label: "Sample all layers", default: false },
      ];
    }
  }

  private diameter(ctx: ToolContext, e: ToolEvent): number {
    return pressureSize(ctx.opt<number>("size"), e.pressure, e.pointerType, ctx.opt<boolean>("pressureSize"));
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (e.altKey) {
      if (this.mode === "clone") {
        this.cloneSource = { x: e.x, y: e.y };
        this.cloneDelta = null;
        ctx.notify("info", `Clone source set at ${Math.round(e.x)}, ${Math.round(e.y)}`);
      } else {
        const c = sampleColor(ctx, e.x, e.y, false, this.sampler);
        if (c) ctx.setFg(c);
      }
      return;
    }
    const layer = paintableLayer(ctx, this.mode === "erase" ? "erase" : "paint");
    if (!layer) return;
    let source: { raster: Raster; delta: Point } | undefined;
    if (this.mode === "clone") {
      if (!this.cloneSource) {
        ctx.notify("info", "Alt-click to set a clone source first.");
        return;
      }
      source = this.cloneSourceFor(ctx, layer, { x: e.x, y: e.y });
    }
    this.stroke = new Stroke(layer, {
      mode: this.mode,
      color: this.mode === "erase" ? ({ r: 0, g: 0, b: 0, a: 255 } as RGBA) : ctx.fg(),
      opacity: ctx.opt<number>("opacity") / 100,
      flow: ctx.opt<number>("flow") / 100,
      hardness: ctx.opt<number>("hardness") / 100,
      spacing: ctx.opt<number>("spacing"),
      selection: ctx.doc.selection,
      layerOffset: layer.offset,
      source,
    });
    const p = toLayerSpace(layer, { x: e.x, y: e.y });
    const d = this.diameter(ctx, e);
    // Shift-click: straight line from the previous stroke's end.
    if (e.shiftKey && this.lastEnd) {
      this.stroke.moveTo(toLayerSpace(layer, this.lastEnd), d);
    }
    const rect = this.stroke.moveTo(p, d);
    if (rect) ctx.touch({ layerId: layer.id, rect });
    this.lastEnd = { x: e.x, y: e.y };
  }

  private cloneSourceFor(ctx: ToolContext, layer: RasterLayer, start: Point): { raster: Raster; delta: Point } {
    const src = this.cloneSource!;
    const aligned = ctx.opt<boolean>("aligned");
    if (!aligned || !this.cloneDelta) this.cloneDelta = { x: src.x - start.x, y: src.y - start.y };
    const delta = this.cloneDelta;
    if (ctx.opt<boolean>("sampleMerged")) {
      // Composite is doc-space: layer px (x,y) ↔ doc (x+off); source doc px = p_doc + delta.
      const raster = compositeToRaster(ctx.doc);
      return { raster, delta: { x: Math.round(delta.x + layer.offset.x), y: Math.round(delta.y + layer.offset.y) } };
    }
    return { raster: layer.raster.clone(), delta: { x: Math.round(delta.x), y: Math.round(delta.y) } };
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { sx: e.screenX, sy: e.screenY };
    ctx.invalidateOverlay();
    const s = this.stroke;
    if (!s) return;
    let p = { x: e.x, y: e.y };
    if (e.shiftKey && this.lastEnd) p = constrainAngle(this.lastEnd, p);
    const rect = s.moveTo(toLayerSpace(s.layer, p), this.diameter(ctx, e));
    if (rect) ctx.touch({ layerId: s.layer.id, rect });
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.lastEnd = { x: e.x, y: e.y };
    const label = this.mode === "paint" ? "Brush Stroke" : this.mode === "erase" ? "Eraser" : "Clone Stamp";
    const cmd = s.finish(label);
    if (cmd) ctx.exec(cmd, { alreadyApplied: true, noMerge: true });
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "[" || e.key === "]") {
      const size = ctx.opt<number>("size");
      const step = size < 10 ? 1 : size < 50 ? 5 : size < 200 ? 10 : 25;
      const next = Math.max(1, Math.min(500, e.key === "[" ? size - step : size + step));
      ctx.setOpt("size", next);
      ctx.invalidateOverlay();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const rect = s.abort();
    if (rect) ctx.touch({ layerId: s.layer.id, rect });
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.hover = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.hover) return;
    const r = (ctx.opt<number>("size") * ctx.viewport.zoom) / 2;
    const { sx, sy } = this.hover;
    g.save();
    g.lineWidth = 1;
    g.beginPath();
    g.arc(sx, sy, Math.max(1.5, r), 0, Math.PI * 2);
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.stroke();
    g.beginPath();
    g.arc(sx, sy, Math.max(1, r - 1), 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.stroke();
    if (this.mode === "clone" && this.cloneSource) {
      const s = ctx.viewport.docToScreen(this.cloneSource);
      g.strokeStyle = "#8b6cff";
      g.beginPath();
      g.moveTo(s.x - 6, s.y);
      g.lineTo(s.x + 6, s.y);
      g.moveTo(s.x, s.y - 6);
      g.lineTo(s.x, s.y + 6);
      g.stroke();
    }
    g.restore();
  }
}
