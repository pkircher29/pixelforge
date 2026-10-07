/**
 * Quick Selection (W): paint to grow a selection from the brushed pixels by Lab colour
 * similarity with an edge-aware stop. Shift/Add mode grows, Alt/Subtract shrinks.
 */
import { Brush } from "@lucide/svelte";
import { Raster, Selection, SetSelectionCommand, activeLayer, compositeToRaster, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { EdgeMapCache } from "./edge-map";
import { LabCache, discIndices, enhanceRegion, growRegion, shrinkRegion } from "./region-grow";

export class QuickSelectionTool implements Tool {
  readonly id = "quick-select";
  readonly name = "Quick Selection";
  readonly icon = Brush;
  readonly shortcut = "w";
  readonly group = "quickselect";
  readonly groupOrder = 0;
  readonly cursor = "crosshair";
  readonly hint = "Drag over an area to select it. Alt-drag subtracts. [ ] change size.";
  readonly options: readonly ToolOption[] = [
    {
      kind: "select",
      key: "mode",
      label: "Mode",
      choices: [
        { value: "new", label: "New" },
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
      ],
      default: "add",
    },
    { kind: "number", key: "size", label: "Size", min: 1, max: 500, step: 1, default: 30, unit: "px", log: true },
    { kind: "number", key: "tolerance", label: "Tolerance", min: 1, max: 60, step: 1, default: 14 },
    { kind: "toggle", key: "sampleAll", label: "Sample All Layers", default: true },
    { kind: "toggle", key: "autoEnhance", label: "Auto-Enhance", default: true },
  ];

  private region: Uint8Array | null = null;
  private subtract = false;
  private startSelection: Selection | null = null;
  private hover: Point | null = null;
  private last: Point | null = null;
  private readonly edges = new EdgeMapCache();
  private readonly labs = new LabCache();

  private source(ctx: ToolContext): Raster {
    if (ctx.opt<boolean>("sampleAll")) return compositeToRaster(ctx.doc);
    const l = activeLayer(ctx.doc);
    if (l && l.kind === "raster") {
      const out = new Raster(ctx.doc.width, ctx.doc.height);
      out.blit(l.raster, l.offset.x, l.offset.y, undefined, { mode: "replace" });
      return out;
    }
    return compositeToRaster(ctx.doc);
  }

  private key(ctx: ToolContext): string {
    return `${ctx.entry.id}:${ctx.entry.pixelVersion}:${ctx.opt<boolean>("sampleAll") ? "all" : ctx.doc.activeLayerId}`;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const mode = ctx.opt<string>("mode");
    this.subtract = e.altKey || (mode === "subtract" && !e.shiftKey);
    const doc = ctx.doc;
    const fresh = mode === "new" && !e.shiftKey && !e.altKey;
    this.startSelection = doc.selection;
    this.region = fresh ? new Uint8Array(doc.width * doc.height) : new Uint8Array(doc.selection.mask);
    if (!fresh) for (let i = 0; i < this.region.length; i++) this.region[i] = this.region[i]! >= 128 ? 255 : 0;
    this.last = null;
    this.brush(ctx, e.x, e.y);
  }

  private brush(ctx: ToolContext, x: number, y: number): void {
    const region = this.region;
    if (!region) return;
    const doc = ctx.doc;
    const w = doc.width;
    const h = doc.height;
    const radius = ctx.opt<number>("size") / 2;
    const key = this.key(ctx);
    const lab = this.labs.get(key, () => this.source(ctx));
    const edge = this.edges.get(key, () => this.source(ctx));
    // Seed along the segment from the last point so fast drags don't leave gaps.
    const seeds = new Set<number>();
    const from = this.last ?? { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / Math.max(1, radius)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const idx of discIndices(w, h, from.x + (x - from.x) * t, from.y + (y - from.y) * t, radius)) seeds.add(idx);
    }
    this.last = { x, y };
    const tolerance = ctx.opt<number>("tolerance");
    if (this.subtract) shrinkRegion(lab, w, h, [...seeds], region, { tolerance });
    else growRegion(lab, w, h, edge, [...seeds], region, { tolerance });
    this.apply(ctx, false);
  }

  private apply(ctx: ToolContext, final: boolean): void {
    const region = this.region;
    if (!region) return;
    const doc = ctx.doc;
    let mask = region;
    if (final && ctx.opt<boolean>("autoEnhance")) mask = enhanceRegion(region, doc.width, doc.height);
    const sel = Selection.fromMask(doc.width, doc.height, new Uint8Array(mask));
    if (final) {
      // Restore the pre-drag selection so the command's undo snapshot is right.
      doc.selection = this.startSelection ?? doc.selection;
      ctx.exec(new SetSelectionCommand(sel, this.subtract ? "Subtract from Selection (Quick Selection)" : "Quick Selection"));
    } else {
      doc.selection = sel;
      ctx.touch();
    }
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { x: e.x, y: e.y };
    ctx.invalidateOverlay();
    if (!this.region) return;
    if (this.last && Math.hypot(e.x - this.last.x, e.y - this.last.y) < 2) return;
    this.brush(ctx, e.x, e.y);
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    if (!this.region) return;
    this.apply(ctx, true);
    this.region = null;
    this.startSelection = null;
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "[" || e.key === "]") {
      const size = ctx.opt<number>("size");
      const step = size < 10 ? 1 : size < 50 ? 5 : 10;
      ctx.setOpt("size", Math.max(1, Math.min(500, e.key === "]" ? size + step : size - step)));
      ctx.invalidateOverlay();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    if (this.region && this.startSelection) {
      ctx.doc.selection = this.startSelection;
      ctx.touch();
    }
    this.region = null;
    this.startSelection = null;
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.hover = null;
    this.edges.clear();
    this.labs.clear();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.hover) return;
    const s = ctx.viewport.docToScreen(this.hover);
    const r = Math.max(2, (ctx.opt<number>("size") * ctx.viewport.zoom) / 2);
    g.save();
    g.lineWidth = 1;
    g.beginPath();
    g.arc(s.x, s.y, r, 0, Math.PI * 2);
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.stroke();
    g.beginPath();
    g.arc(s.x, s.y, Math.max(1, r - 1), 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.stroke();
    // + / − badge for the mode.
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(s.x + r + 6, s.y + r + 9);
    g.lineTo(s.x + r + 14, s.y + r + 9);
    if (!this.subtractNow()) {
      g.moveTo(s.x + r + 10, s.y + r + 5);
      g.lineTo(s.x + r + 10, s.y + r + 13);
    }
    g.stroke();
    g.restore();
  }

  private subtractNow(): boolean {
    return this.region ? this.subtract : false;
  }
}
