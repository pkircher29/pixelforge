/**
 * Path Selection (A): click / drag whole subpaths (or a shape layer's path). Direct
 * Selection: anchors and handles; marquee-select anchors; Delete removes them.
 */
import { MousePointer2, MousePointer } from "@lucide/svelte";
import { Rect, SetShapeLayerCommand, activeLayer, clonePath, findLayer, isLayerEditable, type Path, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { anchorsInRect, deleteAnchors, hitAnchor, hitHandle, moveAnchors, moveHandle, moveSubpath, type AnchorRef } from "./path-edit";
import { drawPath } from "./path-overlay";
import { strokeOutline } from "./util";
import { commitWorkPath, workPathOf } from "./work-path";

/** The path being edited: the active shape layer's path, else the work path. */
export function editablePath(ctx: ToolContext): { path: Path; layerId: string | null } {
  const l = activeLayer(ctx.doc);
  if (l && l.kind === "shape") return { path: l.path, layerId: l.id };
  return { path: workPathOf(ctx), layerId: null };
}

function previewPath(ctx: ToolContext, layerId: string | null, path: Path): void {
  if (layerId) {
    const l = findLayer(ctx.doc, layerId);
    if (l && l.kind === "shape") {
      l.path = path;
      ctx.touch();
    }
    return;
  }
  const d = ctx.doc;
  const i = d.paths.findIndex((p) => p.id === path.id);
  if (i >= 0) d.paths[i] = path;
  ctx.touch();
}

function commitPath(ctx: ToolContext, layerId: string | null, before: Path, after: Path, label: string): void {
  if (layerId) {
    const l = findLayer(ctx.doc, layerId);
    if (l && l.kind === "shape") {
      l.path = before; // restore so the command's undo snapshot is correct
      ctx.exec(new SetShapeLayerCommand(layerId, { path: after }, label), { noMerge: true });
    }
    return;
  }
  commitWorkPath(ctx, before, after, label);
}

export class PathSelectionTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon;
  readonly shortcut = "a";
  readonly group = "pathselect";
  readonly groupOrder: number;
  readonly cursor = "default";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  private readonly direct: boolean;

  private selected: AnchorRef[] = [];
  private selectedSubpaths: number[] = [];
  private drag: { kind: "anchors" | "subpath" | "handle" | "marquee"; start: Point; last: Point; before: Path; layerId: string | null; which?: "in" | "out"; ref?: AnchorRef } | null = null;
  private marquee: Rect | null = null;

  constructor(direct: boolean) {
    this.direct = direct;
    this.id = direct ? "direct-select" : "path-select";
    this.name = direct ? "Direct Selection" : "Path Selection";
    this.icon = direct ? MousePointer2 : MousePointer;
    this.groupOrder = direct ? 1 : 0;
    this.hint = direct ? "Click anchors or handles to drag them; drag a marquee to select several. Delete removes anchors." : "Click a path to select it, drag to move it. Works on the active shape layer or the work path.";
    this.options = direct ? [] : [{ kind: "custom", key: "align", renderer: "align-buttons", label: "Align" }];
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const { path, layerId } = editablePath(ctx);
    if (layerId) {
      const l = findLayer(ctx.doc, layerId);
      if (l && !isLayerEditable(l, "pixels")) {
        ctx.notify("info", `"${l.name}" is locked.`);
        return;
      }
    }
    const p = { x: e.x, y: e.y };
    const tol = 6 / ctx.viewport.zoom;
    const before = clonePath(path);
    if (this.direct) {
      const h = hitHandle(path, p, tol, this.selected);
      if (h) {
        this.drag = { kind: "handle", start: p, last: p, before, layerId, which: h.which, ref: h.ref };
        return;
      }
      const a = hitAnchor(path, p, tol);
      if (a) {
        const already = this.selected.some((r) => r.subpath === a.subpath && r.index === a.index);
        if (e.shiftKey) this.selected = already ? this.selected.filter((r) => !(r.subpath === a.subpath && r.index === a.index)) : [...this.selected, a];
        else if (!already) this.selected = [a];
        this.drag = { kind: "anchors", start: p, last: p, before, layerId };
        ctx.invalidateOverlay();
        return;
      }
      this.drag = { kind: "marquee", start: p, last: p, before, layerId };
      this.marquee = Rect.make(p.x, p.y, 0, 0);
      if (!e.shiftKey) this.selected = [];
      ctx.invalidateOverlay();
      return;
    }
    const si = hitSubpath(path, p, tol * 2);
    if (si === null) {
      this.selectedSubpaths = [];
      ctx.invalidateOverlay();
      return;
    }
    if (e.shiftKey) this.selectedSubpaths = this.selectedSubpaths.includes(si) ? this.selectedSubpaths.filter((x) => x !== si) : [...this.selectedSubpaths, si];
    else if (!this.selectedSubpaths.includes(si)) this.selectedSubpaths = [si];
    this.drag = { kind: "subpath", start: p, last: p, before, layerId };
    ctx.setCursor("move");
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) return;
    const p = { x: e.x, y: e.y };
    const { path } = editablePath(ctx);
    if (d.kind === "marquee") {
      this.marquee = Rect.fromPoints(d.start, p);
      ctx.invalidateOverlay();
      return;
    }
    let dx = p.x - d.last.x;
    let dy = p.y - d.last.y;
    if (e.shiftKey && d.kind !== "handle") {
      const tx = p.x - d.start.x;
      const ty = p.y - d.start.y;
      if (Math.abs(tx) > Math.abs(ty)) dy = 0;
      else dx = 0;
    }
    let next: Path;
    if (d.kind === "handle" && d.ref && d.which) next = moveHandle(path, d.ref, d.which, p, e.altKey);
    else if (d.kind === "anchors") next = moveAnchors(path, this.selected, dx, dy);
    else {
      next = path;
      for (const si of this.selectedSubpaths) next = moveSubpath(next, si, dx, dy);
    }
    d.last = { x: d.last.x + dx, y: d.last.y + dy };
    previewPath(ctx, d.layerId, next);
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    this.drag = null;
    ctx.setCursor("default");
    if (!d) return;
    if (d.kind === "marquee") {
      const r = this.marquee;
      this.marquee = null;
      if (r && r.w > 0 && r.h > 0) this.selected = [...this.selected, ...anchorsInRect(d.before, r).filter((a) => !this.selected.some((s) => s.subpath === a.subpath && s.index === a.index))];
      ctx.invalidateOverlay();
      return;
    }
    const { path } = editablePath(ctx);
    const moved = d.last.x !== d.start.x || d.last.y !== d.start.y || d.kind === "handle";
    if (moved) commitPath(ctx, d.layerId, d.before, path, d.kind === "handle" ? "Edit Handle" : "Move Path");
    ctx.invalidateOverlay();
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    const { path, layerId } = editablePath(ctx);
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.direct && this.selected.length) {
        commitPath(ctx, layerId, clonePath(path), deleteAnchors(path, this.selected), "Delete Anchor Points");
        this.selected = [];
        return true;
      }
      if (!this.direct && this.selectedSubpaths.length) {
        const next = clonePath(path);
        next.subpaths = next.subpaths.filter((_, i) => !this.selectedSubpaths.includes(i));
        commitPath(ctx, layerId, clonePath(path), next, "Delete Path");
        this.selectedSubpaths = [];
        return true;
      }
      return false;
    }
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (dx || dy) {
      let next = path;
      if (this.direct) next = moveAnchors(path, this.selected, dx, dy);
      else for (const si of this.selectedSubpaths) next = moveSubpath(next, si, dx, dy);
      if (next !== path) commitPath(ctx, layerId, clonePath(path), next, "Nudge Path");
      return true;
    }
    if (e.key === "a" && (e.ctrlKey || e.metaKey) && this.direct) {
      this.selected = path.subpaths.flatMap((sp, si) => sp.anchors.map((_, ai) => ({ subpath: si, index: ai })));
      ctx.invalidateOverlay();
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const d = this.drag;
    this.drag = null;
    this.marquee = null;
    if (d && d.kind !== "marquee") previewPath(ctx, d.layerId, d.before);
    ctx.invalidateOverlay();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.selected = [];
    this.selectedSubpaths = [];
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const { path } = editablePath(ctx);
    if (path.subpaths.length) {
      if (this.direct) drawPath(g, ctx.viewport, path, { selected: this.selected });
      else {
        drawPath(g, ctx.viewport, path, { anchors: false });
        // Selected subpaths get their anchors shown filled (PS shows all anchors solid).
        const sel: AnchorRef[] = [];
        for (const si of this.selectedSubpaths) path.subpaths[si]?.anchors.forEach((_, ai) => sel.push({ subpath: si, index: ai }));
        if (sel.length) drawPath(g, ctx.viewport, { ...path, subpaths: path.subpaths.filter((_, i) => this.selectedSubpaths.includes(i)) }, { selected: sel.map((s) => ({ subpath: this.selectedSubpaths.indexOf(s.subpath), index: s.index })), showHandles: false });
      }
    }
    const m = this.marquee;
    if (m) {
      const a = ctx.viewport.docToScreen({ x: m.x, y: m.y });
      const b = ctx.viewport.docToScreen({ x: m.x + m.w, y: m.y + m.h });
      strokeOutline(g, () => {
        g.beginPath();
        g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      });
    }
  }
}

/** Subpath whose flattened outline passes within `tol` of `p` (or whose interior contains it). */
export function hitSubpath(path: Path, p: Point, tol: number): number | null {
  for (let si = 0; si < path.subpaths.length; si++) {
    const sp = path.subpaths[si]!;
    const n = sp.anchors.length;
    for (let i = 0; i < n; i++) {
      const a = sp.anchors[i]!;
      const b = sp.anchors[(i + 1) % n];
      if (!b || (!sp.closed && i === n - 1)) continue;
      for (let t = 0; t <= 1; t += 1 / 16) {
        const mt = 1 - t;
        const x = mt * mt * mt * a.x + 3 * mt * mt * t * a.outX + 3 * mt * t * t * b.inX + t * t * t * b.x;
        const y = mt * mt * mt * a.y + 3 * mt * mt * t * a.outY + 3 * mt * t * t * b.inY + t * t * t * b.y;
        if (Math.hypot(x - p.x, y - p.y) <= tol) return si;
      }
    }
    if (sp.closed && n >= 3 && pointInPolygon(p, sp.anchors)) return si;
  }
  return null;
}

function pointInPolygon(p: Point, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
