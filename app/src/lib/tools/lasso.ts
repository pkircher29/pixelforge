/** Lasso (freehand) and Polygon Lasso (L). */
import { Lasso, LassoSelect } from "@lucide/svelte";
import { Selection, SetSelectionCommand, type Point } from "$lib/engine";
import type { SelectionMode, Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { combineSelection, featherIf, modeFromModifiers, selectionLabel } from "./selection-mod";
import { strokeOutline } from "./util";

const OPTIONS: readonly ToolOption[] = [
  {
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
  },
  { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false },
  { kind: "toggle", key: "antialias", label: "Anti-alias", default: true },
];

export class LassoTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "l";
  readonly group = "lasso";
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options = OPTIONS;
  private readonly polygon: boolean;

  private points: Point[] = [];
  private preview: Point | null = null;
  private mode: SelectionMode = "new";
  private dragging = false;
  private lastClickAt = 0;

  constructor(polygon: boolean) {
    this.polygon = polygon;
    this.id = polygon ? "lasso-polygon" : "lasso";
    this.groupOrder = polygon ? 1 : 0;
    this.name = polygon ? "Polygonal Lasso" : "Lasso";
    this.icon = polygon ? LassoSelect : Lasso;
    this.hint = polygon
      ? "Click to add points. Click the first point, double-click or press Enter to close. Backspace removes the last point."
      : "Drag a freehand outline. Shift adds, Alt subtracts.";
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (!this.polygon) {
      this.points = [{ x: e.x, y: e.y }];
      this.dragging = true;
      this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
      ctx.invalidateOverlay();
      return;
    }
    const now = performance.now();
    const p = { x: e.x, y: e.y };
    if (this.points.length === 0) {
      this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
      this.points.push(p);
    } else {
      const first = this.points[0]!;
      const closeEnough = Math.hypot(first.x - p.x, first.y - p.y) * ctx.viewport.zoom < 8;
      const dbl = now - this.lastClickAt < 350;
      if ((closeEnough && this.points.length >= 3) || dbl) {
        this.close(ctx);
        this.lastClickAt = 0;
        return;
      }
      this.points.push(p);
    }
    this.lastClickAt = now;
    this.preview = p;
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.polygon) {
      if (this.points.length) {
        this.preview = { x: e.x, y: e.y };
        ctx.invalidateOverlay();
      }
      return;
    }
    if (!this.dragging) return;
    const last = this.points[this.points.length - 1]!;
    if (Math.hypot(last.x - e.x, last.y - e.y) * ctx.viewport.zoom >= 1.5) {
      this.points.push({ x: e.x, y: e.y });
      ctx.invalidateOverlay();
    }
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    if (this.polygon || !this.dragging) return;
    this.dragging = false;
    this.close(ctx);
  }

  private close(ctx: ToolContext): void {
    const pts = this.points;
    this.points = [];
    this.preview = null;
    ctx.invalidateOverlay();
    const { width, height } = ctx.doc;
    if (pts.length < 3) {
      if (this.mode === "new" && !ctx.doc.selection.isEmpty) {
        ctx.exec(new SetSelectionCommand(Selection.none(width, height), "Deselect"));
      }
      return;
    }
    let shape = Selection.fromPolygon(width, height, pts, ctx.opt<boolean>("antialias"));
    shape = featherIf(shape, ctx.opt<number>("feather"));
    const next = combineSelection(ctx.doc.selection, shape, this.mode);
    ctx.exec(new SetSelectionCommand(next, selectionLabel(this.polygon ? "Polygon" : "Lasso", this.mode)));
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || !this.polygon || this.points.length === 0) return false;
    if (e.key === "Enter") {
      this.close(ctx);
      return true;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      this.points.pop();
      ctx.invalidateOverlay();
      return true;
    }
    if (e.key === "Escape") {
      this.cancel(ctx);
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    this.points = [];
    this.preview = null;
    this.dragging = false;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (this.points.length === 0) return;
    const vp = ctx.viewport;
    const pts = this.points.map((p) => vp.docToScreen(p));
    strokeOutline(g, () => {
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      if (this.polygon && this.preview) {
        const s = vp.docToScreen(this.preview);
        g.lineTo(s.x, s.y);
      } else if (!this.polygon) g.closePath();
    });
    if (this.polygon) {
      const f = pts[0]!;
      g.save();
      g.fillStyle = "#8b6cff";
      g.beginPath();
      g.arc(f.x, f.y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}
