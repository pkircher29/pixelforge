import { Eraser } from "@lucide/svelte";
import { Selection, SetSelectionCommand, type Point } from "$lib/engine";
import { aiUi } from "$lib/ai/ui.svelte";
import { discIndices } from "./region-grow";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";

/** Paint an explicit removal mask; generation is reviewed before any provider call. */
export class RemoveTool implements Tool {
  readonly id = "remove";
  readonly name = "Remove";
  readonly icon = Eraser;
  readonly glyph = "healing-spot";
  readonly shortcut = "j";
  readonly group = "healing";
  readonly groupOrder = 1;
  readonly cursor = "crosshair";
  readonly hint = "Brush over the object, then Generate. Alt subtracts; [ ] change size; Esc cancels a stroke.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "size", label: "Size", min: 1, max: 500, default: 40, step: 1, unit: "px", log: true },
    { kind: "select", key: "mode", label: "Mode", choices: [{ value: "add", label: "Add" }, { value: "subtract", label: "Subtract" }], default: "add" },
    { kind: "button", key: "review", label: "Review removal…", primary: true, action: (ctx) => this.review(ctx) },
    { kind: "button", key: "clear", label: "Clear", action: (ctx) => {
      this.cancel(ctx);
      ctx.exec(new SetSelectionCommand(Selection.none(ctx.doc.width, ctx.doc.height), "Clear Removal Area"));
    } },
  ];
  private before: Selection | null = null;
  private mask: Uint8Array | null = null;
  private last: Point | null = null;
  private hover: Point | null = null;
  private subtract = false;
  private readonly areas = new WeakSet<Selection>();

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.before = ctx.doc.selection;
    this.subtract = e.altKey || ctx.opt<string>("mode") === "subtract";
    const owned = this.areas.has(this.before);
    this.mask = owned ? this.before.mask.slice() : new Uint8Array(ctx.doc.width * ctx.doc.height);
    this.last = null;
    this.paint(e, ctx);
  }

  private paint(e: ToolEvent, ctx: ToolContext): void {
    if (!this.mask) return;
    const radius = Math.max(0.5, ctx.opt<number>("size") / 2);
    const from = this.last ?? e;
    const steps = Math.max(1, Math.ceil(Math.hypot(e.x - from.x, e.y - from.y) / Math.max(1, radius / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const index of discIndices(ctx.doc.width, ctx.doc.height, from.x + (e.x - from.x) * t, from.y + (e.y - from.y) * t, radius)) {
        this.mask[index] = this.subtract ? 0 : 255;
      }
    }
    this.last = { x: e.x, y: e.y };
    ctx.doc.selection = Selection.fromMask(ctx.doc.width, ctx.doc.height, this.mask.slice());
    ctx.touch();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { x: e.x, y: e.y };
    this.paint(e, ctx);
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    if (!this.mask || !this.before) return;
    const selection = ctx.doc.selection;
    const continuation = this.areas.has(this.before);
    ctx.doc.selection = this.before;
    ctx.exec(new SetSelectionCommand(selection, this.subtract ? "Subtract Removal Area" : "Paint Removal Area"));
    this.areas.add(selection);
    aiUi.prepareRemoval(ctx.entry.id, selection, !continuation);
    if (selection.isAll) ctx.notify("info", "Leave some surrounding image unmarked so removal has context.");
    this.mask = null;
    this.before = null;
    this.last = null;
  }

  private review(ctx: ToolContext): void {
    if (ctx.doc.selection.isEmpty || ctx.doc.selection.isAll) {
      ctx.notify("info", "Brush over the object to remove, leaving some surrounding image for context.");
      return;
    }
    aiUi.prepareRemoval(ctx.entry.id, ctx.doc.selection, aiUi.removal?.selection !== ctx.doc.selection);
    aiUi.focusGenerativeFill();
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "Escape") { this.cancel(ctx); return true; }
    if (e.key === "[" || e.key === "]") {
      ctx.setOpt("size", Math.max(1, Math.min(500, ctx.opt<number>("size") + (e.key === "]" ? 5 : -5))));
      ctx.invalidateOverlay();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    if (this.before) { ctx.doc.selection = this.before; ctx.touch(); }
    this.mask = null;
    this.before = null;
    this.last = null;
    ctx.invalidateOverlay();
  }
  onDeactivate(ctx: ToolContext): void { this.cancel(ctx); this.hover = null; }
  onPointerLeave(ctx: ToolContext): void { this.hover = null; ctx.invalidateOverlay(); }
  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.hover) return;
    const p = ctx.viewport.docToScreen(this.hover);
    g.save();
    g.beginPath();
    g.arc(p.x, p.y, Math.max(1, ctx.opt<number>("size") * ctx.viewport.zoom / 2), 0, Math.PI * 2);
    g.lineWidth = 3; g.strokeStyle = "#0008"; g.stroke();
    g.lineWidth = 1; g.strokeStyle = "white"; g.stroke();
    g.restore();
  }
}
