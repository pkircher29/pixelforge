/**
 * Pen (P), Freeform Pen, Add / Delete Anchor Point, Convert Point.
 *
 * Pen: click = corner anchor, drag = smooth anchor with handles, Alt-drag breaks the
 * handles, Ctrl = temporary Direct Selection, click the first anchor to close, rubber
 * band preview, Esc ends an open path. Writes the work path (`doc.paths` /
 * `doc.workPathId`) through `setPathCommand`; in Shape mode it creates a shape layer.
 */
import { PenTool, PenLine, Plus, Minus, CornerDownRight } from "@lucide/svelte";
import { clonePath, nearestSegment, splitSegmentAt, type Path, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import {
  appendAnchor,
  beginSubpath,
  closeLastSubpath,
  convertAnchor,
  deleteAnchor,
  dragOutHandle,
  fitFreehand,
  hitAnchor,
  hitHandle,
  lastSubpathOpen,
  moveAnchor,
  moveHandle,
  type AnchorRef,
} from "./path-edit";
import { drawPath } from "./path-overlay";
import { SHAPE_FILL_OPTION, SHAPE_STROKE_OPTION, STROKE_WIDTH_OPTION, createShapeFromPath, PEN_MODE_OPTION } from "./shapes";
import { commitWorkPath, previewWorkPath, workPathOf } from "./work-path";

export { workPathOf, commitWorkPath };

export class PenToolImpl implements Tool {
  readonly id = "pen";
  readonly name = "Pen";
  readonly icon = PenTool;
  readonly shortcut = "p";
  readonly group = "pen";
  readonly groupOrder = 0;
  readonly cursor = "crosshair";
  readonly hint = "Click for corners, drag for curves. Alt-drag breaks handles, Ctrl = Direct Selection, click the first anchor to close, Esc ends the path.";
  readonly options: readonly ToolOption[] = [
    PEN_MODE_OPTION,
    SHAPE_FILL_OPTION,
    SHAPE_STROKE_OPTION,
    STROKE_WIDTH_OPTION,
    { kind: "toggle", key: "autoAddDelete", label: "Auto Add/Delete", default: true },
    { kind: "toggle", key: "rubberBand", label: "Rubber Band", default: true },
  ];

  private before: Path | null = null;
  private live: Path | null = null;
  private dragging: { ref: AnchorRef; start: Point; kind: "new" | "anchor" | "handle"; which?: "in" | "out" } | null = null;
  private hover: Point | null = null;

  private current(ctx: ToolContext): Path {
    return this.live ?? workPathOf(ctx);
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const path = this.current(ctx);
    const p = { x: e.x, y: e.y };
    const tol = 6 / ctx.viewport.zoom;
    this.before = this.before ?? clonePath(path);
    // Ctrl: temporary direct selection — drag an anchor or a handle.
    if (e.ctrlKey) {
      const h = hitHandle(path, p, tol);
      if (h) {
        this.dragging = { ref: h.ref, start: p, kind: "handle", which: h.which };
        return;
      }
      const a = hitAnchor(path, p, tol);
      if (a) this.dragging = { ref: a, start: p, kind: "anchor" };
      return;
    }
    const open = lastSubpathOpen(path);
    if (open) {
      const sp = path.subpaths[path.subpaths.length - 1]!;
      const first = sp.anchors[0]!;
      if (sp.anchors.length >= 2 && Math.hypot(first.x - p.x, first.y - p.y) <= tol) {
        // Close the path by clicking the first anchor (drag to shape its in-handle).
        const closed = closeLastSubpath(path);
        this.live = closed;
        this.dragging = { ref: { subpath: path.subpaths.length - 1, index: 0 }, start: p, kind: "new" };
        previewWorkPath(ctx, closed);
        return;
      }
      // Auto add/delete: clicking an existing anchor deletes it, clicking a segment adds one.
      if (ctx.opt<boolean>("autoAddDelete")) {
        const a = hitAnchor(path, p, tol);
        if (a && !(a.subpath === path.subpaths.length - 1 && a.index === sp.anchors.length - 1)) {
          this.finishEdit(ctx, deleteAnchor(path, a), "Delete Anchor Point");
          return;
        }
      }
      const next = appendAnchor(path, p);
      this.live = next;
      this.dragging = { ref: { subpath: next.subpaths.length - 1, index: next.subpaths[next.subpaths.length - 1]!.anchors.length - 1 }, start: p, kind: "new" };
      previewWorkPath(ctx, next);
      return;
    }
    if (ctx.opt<boolean>("autoAddDelete")) {
      const a = hitAnchor(path, p, tol);
      if (a) {
        this.finishEdit(ctx, deleteAnchor(path, a), "Delete Anchor Point");
        return;
      }
      const seg = nearestSegment(path, p, tol);
      if (seg) {
        this.finishEdit(ctx, splitSegmentAt(path, seg.subpath, seg.index, seg.t), "Add Anchor Point");
        return;
      }
    }
    const next = beginSubpath(path, p);
    this.live = next;
    this.dragging = { ref: { subpath: next.subpaths.length - 1, index: 0 }, start: p, kind: "new" };
    previewWorkPath(ctx, next);
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { x: e.x, y: e.y };
    const d = this.dragging;
    if (!d) {
      ctx.invalidateOverlay();
      return;
    }
    const p = { x: e.x, y: e.y };
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * ctx.viewport.zoom < 2 && d.kind === "new") return;
    const path = this.current(ctx);
    let next: Path;
    if (d.kind === "new") next = dragOutHandle(path, d.ref, p, e.altKey);
    else if (d.kind === "handle") next = moveHandle(path, d.ref, d.which!, p, e.altKey);
    else {
      next = moveAnchor(path, d.ref, p.x - d.start.x, p.y - d.start.y);
      d.start = p;
    }
    this.live = next;
    previewWorkPath(ctx, next);
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    const d = this.dragging;
    this.dragging = null;
    if (!d) return;
    const path = this.current(ctx);
    if (d.kind !== "new") {
      this.finishEdit(ctx, path, "Edit Path");
      return;
    }
    const sp = path.subpaths[d.ref.subpath];
    if (sp?.closed) {
      this.finishEdit(ctx, path, "Close Path");
      this.maybeCreateShape(ctx, path, d.ref.subpath);
      return;
    }
    // Keep the live path while the subpath is open; commit on close / Esc.
    this.live = path;
    ctx.invalidateOverlay();
  }

  private finishEdit(ctx: ToolContext, next: Path, label: string): void {
    const before = this.before ?? workPathOf(ctx);
    this.before = null;
    this.live = null;
    commitWorkPath(ctx, before, next, label);
    ctx.invalidateOverlay();
  }

  private maybeCreateShape(ctx: ToolContext, path: Path, subpath: number): void {
    if (ctx.opt<string>("mode") !== "shape") return;
    const sp = path.subpaths[subpath];
    if (!sp) return;
    // Move the closed subpath out of the work path into a new shape layer.
    const rest = clonePath(path);
    rest.subpaths.splice(subpath, 1);
    commitWorkPath(ctx, path, rest, "Pen Shape");
    createShapeFromPath(ctx, { id: `shape_${Date.now().toString(36)}`, name: "Shape", subpaths: [sp] }, "Pen");
  }

  /** Esc / Enter: end the open path (keeps it open-ended). */
  endPath(ctx: ToolContext): void {
    const live = this.live;
    if (!live) return;
    this.finishEdit(ctx, live, "Pen Path");
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "Escape" || e.key === "Enter") {
      if (this.live) {
        this.endPath(ctx);
        return true;
      }
      return false;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const path = this.current(ctx);
      if (!lastSubpathOpen(path)) return false;
      const sp = path.subpaths[path.subpaths.length - 1]!;
      const next = deleteAnchor(path, { subpath: path.subpaths.length - 1, index: sp.anchors.length - 1 });
      this.live = next;
      previewWorkPath(ctx, next);
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    if (this.live) this.endPath(ctx);
    this.dragging = null;
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.hover = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const path = this.current(ctx);
    if (path.subpaths.length === 0) return;
    const open = lastSubpathOpen(path);
    const last = path.subpaths[path.subpaths.length - 1]!;
    const sel: AnchorRef[] = open ? [{ subpath: path.subpaths.length - 1, index: last.anchors.length - 1 }] : [];
    const rubber = open && this.hover && !this.dragging && ctx.opt<boolean>("rubberBand") ? { x: this.hover.x, y: this.hover.y } : null;
    drawPath(g, ctx.viewport, path, { selected: sel, rubber, showHandles: true });
  }
}

/** Freeform Pen: draw freehand, fitted to a smooth path on release. */
export class FreeformPenTool implements Tool {
  readonly id = "pen-freeform";
  readonly name = "Freeform Pen";
  readonly icon = PenLine;
  readonly shortcut = "p";
  readonly group = "pen";
  readonly groupOrder = 1;
  readonly cursor = "crosshair";
  readonly hint = "Drag to draw a path freehand; it is fitted with smooth anchors on release. Curve Fit sets the tolerance.";
  readonly options: readonly ToolOption[] = [
    PEN_MODE_OPTION,
    SHAPE_FILL_OPTION,
    SHAPE_STROKE_OPTION,
    STROKE_WIDTH_OPTION,
    { kind: "number", key: "curveFit", label: "Curve Fit", min: 0.5, max: 10, step: 0.5, default: 2, unit: "px", slider: false },
  ];

  private points: Point[] = [];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.points = [{ x: e.x, y: e.y }];
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.points.length) return;
    const last = this.points[this.points.length - 1]!;
    if (Math.hypot(e.x - last.x, e.y - last.y) * ctx.viewport.zoom >= 1.5) {
      this.points.push({ x: e.x, y: e.y });
      ctx.invalidateOverlay();
    }
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const pts = this.points;
    this.points = [];
    ctx.invalidateOverlay();
    if (pts.length < 2) return;
    const first = pts[0]!;
    const closed = Math.hypot(first.x - e.x, first.y - e.y) * ctx.viewport.zoom < 10;
    const sub = fitFreehand(pts, ctx.opt<number>("curveFit"), closed);
    const before = workPathOf(ctx);
    if (ctx.opt<string>("mode") === "shape" && closed) {
      createShapeFromPath(ctx, { id: `shape_${Date.now().toString(36)}`, name: "Shape", subpaths: [sub] }, "Freeform Pen");
      return;
    }
    const next = clonePath(before);
    next.subpaths.push(sub);
    commitWorkPath(ctx, before, next, "Freeform Pen");
  }

  cancel(ctx: ToolContext): void {
    this.points = [];
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const path = workPathOf(ctx);
    if (path.subpaths.length) drawPath(g, ctx.viewport, path, { anchors: false });
    if (this.points.length < 2) return;
    const vp = ctx.viewport;
    g.save();
    g.strokeStyle = "#1473e6";
    g.lineWidth = 1;
    g.beginPath();
    const s0 = vp.docToScreen(this.points[0]!);
    g.moveTo(s0.x, s0.y);
    for (const p of this.points) {
      const s = vp.docToScreen(p);
      g.lineTo(s.x, s.y);
    }
    g.stroke();
    g.restore();
  }
}

/** Add Anchor / Delete Anchor / Convert Point: single-click editors on the work path. */
export class AnchorEditTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "p";
  readonly group = "pen";
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options: readonly ToolOption[] = [];
  private readonly kind: "add" | "delete" | "convert";
  private drag: { ref: AnchorRef; before: Path } | null = null;

  constructor(kind: "add" | "delete" | "convert") {
    this.kind = kind;
    this.id = kind === "add" ? "pen-add" : kind === "delete" ? "pen-delete" : "pen-convert";
    this.name = kind === "add" ? "Add Anchor Point" : kind === "delete" ? "Delete Anchor Point" : "Convert Point";
    this.icon = kind === "add" ? Plus : kind === "delete" ? Minus : CornerDownRight;
    this.groupOrder = kind === "add" ? 3 : kind === "delete" ? 4 : 5;
    this.hint = kind === "add" ? "Click a path segment to add an anchor." : kind === "delete" ? "Click an anchor to delete it." : "Click an anchor to toggle corner / smooth; drag to pull out handles.";
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const path = workPathOf(ctx);
    const p = { x: e.x, y: e.y };
    const tol = 6 / ctx.viewport.zoom;
    if (this.kind === "add") {
      const seg = nearestSegment(path, p, tol);
      if (seg) commitWorkPath(ctx, path, splitSegmentAt(path, seg.subpath, seg.index, seg.t), "Add Anchor Point");
      return;
    }
    const a = hitAnchor(path, p, tol);
    if (!a) return;
    if (this.kind === "delete") {
      commitWorkPath(ctx, path, deleteAnchor(path, a), "Delete Anchor Point");
      return;
    }
    this.drag = { ref: a, before: clonePath(path) };
    const next = convertAnchor(path, a);
    previewWorkPath(ctx, next);
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) return;
    const path = workPathOf(ctx);
    previewWorkPath(ctx, dragOutHandle(path, d.ref, { x: e.x, y: e.y }, false));
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    commitWorkPath(ctx, d.before, workPathOf(ctx), "Convert Point");
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const path = workPathOf(ctx);
    if (path.subpaths.length) drawPath(g, ctx.viewport, path, { showHandles: true });
  }
}
