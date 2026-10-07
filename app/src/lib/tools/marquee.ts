/** Rectangular / Elliptical / Single Row / Single Column Marquee (M). Shift square, Alt from centre, Shift/Alt at press = add/subtract. */
import { SquareDashed, CircleDashed, Minus, SeparatorVertical } from "@lucide/svelte";
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

const STYLE_OPTION: ToolOption = {
  kind: "select",
  key: "style",
  label: "Style",
  choices: [
    { value: "normal", label: "Normal" },
    { value: "ratio", label: "Fixed Ratio" },
    { value: "size", label: "Fixed Size" },
  ],
  default: "normal",
};

export type MarqueeShape = "rect" | "ellipse" | "row" | "column";

export class MarqueeTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "m";
  readonly group = "marquee";
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  private readonly shape: MarqueeShape;

  private anchor: Point | null = null;
  private cur: Point | null = null;
  private mode: SelectionMode = "new";
  private usedShift = false;
  private usedAlt = false;
  private hover: Point | null = null;

  constructor(shape: MarqueeShape) {
    this.shape = shape;
    this.id = shape === "rect" ? "marquee-rect" : shape === "ellipse" ? "marquee-ellipse" : shape === "row" ? "marquee-row" : "marquee-column";
    this.groupOrder = ["rect", "ellipse", "row", "column"].indexOf(shape);
    this.name = shape === "rect" ? "Rectangular Marquee" : shape === "ellipse" ? "Elliptical Marquee" : shape === "row" ? "Single Row Marquee" : "Single Column Marquee";
    this.icon = shape === "rect" ? SquareDashed : shape === "ellipse" ? CircleDashed : shape === "row" ? Minus : SeparatorVertical;
    const line = shape === "row" || shape === "column";
    this.hint = line
      ? `Click to select a 1 px ${shape}. Shift adds, Alt subtracts.`
      : "Drag to select. Shift: square / add, Alt: from centre / subtract, Shift+Alt: intersect. Space while dragging moves the marquee.";
    this.options = line
      ? [MODE_OPTION, { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false }]
      : [
          MODE_OPTION,
          { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false },
          ...(shape === "ellipse" ? [{ kind: "toggle", key: "antialias", label: "Anti-alias", default: true } as ToolOption] : []),
          STYLE_OPTION,
          { kind: "number", key: "ratioW", label: "Width", min: 0.01, max: 10000, step: 1, default: 1, slider: false },
          { kind: "number", key: "ratioH", label: "Height", min: 0.01, max: 10000, step: 1, default: 1, slider: false },
        ];
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
    if (this.shape === "row" || this.shape === "column") {
      this.commitLine(e, ctx);
      return;
    }
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    this.usedShift = e.shiftKey;
    this.usedAlt = e.altKey;
    ctx.invalidateOverlay();
  }

  private commitLine(e: ToolEvent, ctx: ToolContext): void {
    const { width, height } = ctx.doc;
    const x = Math.max(0, Math.min(width - 1, Math.floor(e.x)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(e.y)));
    const r = this.shape === "row" ? Rect.make(0, y, width, 1) : Rect.make(x, 0, 1, height);
    let shape = Selection.fromRect(width, height, r);
    shape = featherIf(shape, ctx.opt<number>("feather"));
    const next = combineSelection(ctx.doc.selection, shape, this.mode);
    ctx.exec(new SetSelectionCommand(next, selectionLabel(this.shape === "row" ? "Single Row" : "Single Column", this.mode)));
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { x: e.x, y: e.y };
    if (this.shape === "row" || this.shape === "column") {
      ctx.invalidateOverlay();
      return;
    }
    if (!this.anchor) return;
    this.cur = { x: e.x, y: e.y };
    ctx.invalidateOverlay();
  }

  private currentRect(ctx: ToolContext, e: { shiftKey: boolean; altKey: boolean }): Rect | null {
    if (!this.anchor || !this.cur) return null;
    const style = ctx.opt<string>("style");
    if (style === "size") {
      const w = ctx.opt<number>("ratioW");
      const h = ctx.opt<number>("ratioH");
      return Rect.make(this.anchor.x, this.anchor.y, w, h);
    }
    let r = dragRect(this.anchor, this.cur, { square: e.shiftKey && !this.usedShift, fromCenter: e.altKey && !this.usedAlt });
    if (style === "ratio") {
      const rw = ctx.opt<number>("ratioW");
      const rh = ctx.opt<number>("ratioH");
      const ratio = rw / rh;
      const dx = this.cur.x - this.anchor.x;
      const dy = this.cur.y - this.anchor.y;
      const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
      const h = w / ratio;
      r = Rect.make(dx < 0 ? this.anchor.x - w : this.anchor.x, dy < 0 ? this.anchor.y - h : this.anchor.y, w, h);
    }
    return r;
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const anchor = this.anchor;
    if (!anchor) return;
    this.cur = { x: e.x, y: e.y };
    const r = this.currentRect(ctx, e);
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
    const { width, height } = ctx.doc;
    if (!r || (ctx.opt<string>("style") !== "size" && isClick(anchor, { x: e.x, y: e.y }, ctx.viewport.zoom))) {
      if (this.mode === "new" && !ctx.doc.selection.isEmpty) {
        ctx.exec(new SetSelectionCommand(Selection.none(width, height), "Deselect"));
      }
      return;
    }
    const docRect = Rect.intersect(Rect.roundOut(r), Rect.ofSize(width, height));
    if (Rect.isEmpty(docRect)) return;
    let shape = this.shape === "rect" ? Selection.fromRect(width, height, docRect) : Selection.fromEllipse(width, height, r, ctx.opt<boolean>("antialias"));
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
    if (this.shape === "row" || this.shape === "column") {
      const h = this.hover;
      if (!h) return;
      const { width, height } = ctx.doc;
      const r = this.shape === "row" ? Rect.make(0, Math.floor(h.y), width, 1) : Rect.make(Math.floor(h.x), 0, 1, height);
      const s = docRectToScreen(ctx.viewport, r);
      strokeOutline(g, () => {
        g.beginPath();
        g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.max(1, Math.round(s.w)), Math.max(1, Math.round(s.h)));
      });
      return;
    }
    const r = this.currentRect(ctx, { shiftKey: false, altKey: false });
    if (!r) return;
    const s = docRectToScreen(ctx.viewport, r);
    strokeOutline(g, () => {
      g.beginPath();
      if (this.shape === "rect") g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
      else g.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(0.5, s.w / 2), Math.max(0.5, s.h / 2), 0, 0, Math.PI * 2);
    });
    const label = `W: ${Math.round(r.w)}  H: ${Math.round(r.h)}`;
    g.save();
    g.font = "11px Segoe UI, sans-serif";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(30,30,30,0.9)";
    g.fillRect(s.x + s.w + 8, s.y + s.h + 8, tw, 18);
    g.fillStyle = "#e6e6e6";
    g.fillText(label, s.x + s.w + 13, s.y + s.h + 21);
    g.restore();
  }
}
