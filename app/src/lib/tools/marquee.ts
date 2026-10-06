/** Rectangular / Elliptical Marquee (M). Shift square, Alt from centre, Shift/Alt at press = add/subtract. */
import { SquareDashed, CircleDashed } from "@lucide/svelte";
import { Rect, Selection, SetSelectionCommand, type Point } from "$lib/engine";
import type { SelectionMode, Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { combineSelection, dragRect, featherIf, isClick, modeFromModifiers, selectionLabel } from "./selection-mod";
import { docRectToScreen, strokeOutline } from "./util";

const MODE_OPTION: ToolOption = {
  kind: "select",
  key: "mode",
  label: "Mode",
  choices: [
    { value: "new", label: "New" },
    { value: "add", label: "Add" },
    { value: "subtract", label: "Subtract" },
    { value: "intersect", label: "Intersect" },
  ],
  default: "new",
};

export class MarqueeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "m";
  readonly group = "marquee";
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint = "Drag to select. Shift: square / add, Alt: from centre / subtract, Shift+Alt: intersect.";
  readonly options: readonly ToolOption[];
  private readonly shape: "rect" | "ellipse";

  private anchor: Point | null = null;
  private cur: Point | null = null;
  private mode: SelectionMode = "new";
  private usedShift = false;
  private usedAlt = false;

  constructor(shape: "rect" | "ellipse") {
    this.shape = shape;
    this.id = shape === "rect" ? "marquee-rect" : "marquee-ellipse";
    this.groupOrder = shape === "rect" ? 0 : 1;
    this.name = shape === "rect" ? "Rectangular Marquee" : "Elliptical Marquee";
    this.icon = shape === "rect" ? SquareDashed : CircleDashed;
    this.options = [
      MODE_OPTION,
      { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false },
      ...(shape === "ellipse" ? [{ kind: "toggle", key: "antialias", label: "Anti-alias", default: true } as ToolOption] : []),
    ];
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
    this.usedShift = e.shiftKey;
    this.usedAlt = e.altKey;
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.anchor) return;
    this.cur = { x: e.x, y: e.y };
    ctx.invalidateOverlay();
  }

  private currentRect(e: { shiftKey: boolean; altKey: boolean }): Rect | null {
    if (!this.anchor || !this.cur) return null;
    return dragRect(this.anchor, this.cur, {
      square: e.shiftKey && !this.usedShift,
      fromCenter: e.altKey && !this.usedAlt,
    });
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const anchor = this.anchor;
    if (!anchor) return;
    this.cur = { x: e.x, y: e.y };
    const r = this.currentRect(e);
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
    const { width, height } = ctx.doc;
    if (!r || isClick(anchor, { x: e.x, y: e.y }, ctx.viewport.zoom)) {
      if (this.mode === "new" && !ctx.doc.selection.isEmpty) {
        ctx.exec(new SetSelectionCommand(Selection.none(width, height), "Deselect"));
      }
      return;
    }
    const docRect = Rect.intersect(Rect.roundOut(r), Rect.ofSize(width, height));
    if (Rect.isEmpty(docRect)) return;
    let shape =
      this.shape === "rect"
        ? Selection.fromRect(width, height, docRect)
        : Selection.fromEllipse(width, height, r, ctx.opt<boolean>("antialias"));
    shape = featherIf(shape, ctx.opt<number>("feather"));
    const next = combineSelection(ctx.doc.selection, shape, this.mode);
    ctx.exec(new SetSelectionCommand(next, selectionLabel(this.shape === "rect" ? "Rectangle" : "Ellipse", this.mode)));
  }

  cancel(ctx: ToolContext): void {
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const r = this.currentRect({ shiftKey: false, altKey: false });
    if (!r) return;
    const s = docRectToScreen(ctx.viewport, r);
    strokeOutline(g, () => {
      g.beginPath();
      if (this.shape === "rect") g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
      else g.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(0.5, s.w / 2), Math.max(0.5, s.h / 2), 0, 0, Math.PI * 2);
    });
    // Size readout near the cursor.
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    g.save();
    g.font = "11px Cascadia Code, Consolas, monospace";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(10,12,17,0.85)";
    g.fillRect(s.x + s.w + 8, s.y + s.h + 8, tw, 18);
    g.fillStyle = "#e9ecf3";
    g.fillText(label, s.x + s.w + 13, s.y + s.h + 21);
    g.restore();
  }
}
