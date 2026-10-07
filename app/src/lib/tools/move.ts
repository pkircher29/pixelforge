/**
 * Move (V): drags the active layer (and linked layers / linked masks) with
 * `MoveLayersCommand`; auto-select layer / group, transform controls (handles launch
 * Free Transform), align buttons (to the selection or canvas), arrow nudges, respects
 * `lock.position`.
 */
import { Move } from "@lucide/svelte";
import { MoveLayersCommand, activeLayer, findLayer, isLayerEditable, layerDocRect, layerVisualRect, type Layer, type LayerId, type Point, type Rect } from "$lib/engine";
import { runCommand } from "$lib/ui/registry.svelte";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { docRectToScreen, drawHandle, strokeOutline } from "./util";
import { lockReason } from "./paint-target";

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Offset delta that aligns `rect` inside `target`. */
export function alignDelta(rect: Rect, target: Rect, kind: AlignKind): Point {
  switch (kind) {
    case "left":
      return { x: target.x - rect.x, y: 0 };
    case "hcenter":
      return { x: Math.round(target.x + target.w / 2 - (rect.x + rect.w / 2)), y: 0 };
    case "right":
      return { x: target.x + target.w - (rect.x + rect.w), y: 0 };
    case "top":
      return { x: 0, y: target.y - rect.y };
    case "vcenter":
      return { x: 0, y: Math.round(target.y + target.h / 2 - (rect.y + rect.h / 2)) };
    case "bottom":
      return { x: 0, y: target.y + target.h - (rect.y + rect.h) };
  }
}

export class MoveTool implements Tool {
  readonly id = "move";
  readonly name = "Move";
  readonly icon = Move;
  readonly shortcut = "v";
  readonly group = "move";
  readonly groupOrder = 0;
  readonly cursor = "default";
  readonly hint = "Drag to move the active layer. Arrow keys nudge 1 px (Shift: 10 px). Ctrl-click auto-selects.";
  readonly options: readonly ToolOption[] = [
    { kind: "toggle", key: "autoSelect", label: "Auto-Select", default: false },
    {
      kind: "select",
      key: "autoSelectKind",
      label: "",
      choices: [
        { value: "layer", label: "Layer" },
        { value: "group", label: "Group" },
      ],
      default: "layer",
    },
    { kind: "toggle", key: "transformControls", label: "Show Transform Controls", default: false },
    { kind: "custom", key: "align", renderer: "align-buttons", label: "" },
  ];

  private drag: { ids: LayerId[]; start: Point; last: Point; moved: boolean } | null = null;

  /** Layers moved together: the active layer (or its group's children). */
  private moveSet(ctx: ToolContext, layer: Layer): LayerId[] {
    if (layer.kind === "group") return ctx.doc.layers.filter((l) => l.parentId === layer.id).map((l) => l.id);
    return [layer.id];
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (ctx.opt<boolean>("autoSelect") || e.ctrlKey) {
      const hit = topmostHit(ctx, e.x, e.y);
      if (hit) {
        const group = ctx.opt<string>("autoSelectKind") === "group" && hit.parentId ? findLayer(ctx.doc, hit.parentId) : null;
        ctx.setActiveLayer(group ? group.id : hit.id);
      }
    }
    const layer = activeLayer(ctx.doc);
    if (!layer) return;
    if (ctx.opt<boolean>("transformControls") && layer.kind !== "group" && this.hitHandle(ctx, layer, e.screenX, e.screenY)) {
      void runCommand("edit.transform");
      return;
    }
    const reason = lockReason(layer, "position");
    if (reason) {
      ctx.notify("info", reason);
      return;
    }
    const ids = this.moveSet(ctx, layer);
    if (ids.length === 0) {
      ctx.notify("info", "The group is empty.");
      return;
    }
    for (const id of ids) {
      const l = findLayer(ctx.doc, id);
      if (l && !isLayerEditable(l, "position")) {
        ctx.notify("info", lockReason(l, "position") ?? "Locked.");
        return;
      }
    }
    this.drag = { ids, start: { x: e.x, y: e.y }, last: { x: e.x, y: e.y }, moved: false };
    ctx.setCursor("move");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) {
      const l = activeLayer(ctx.doc);
      if (l && ctx.opt<boolean>("transformControls") && l.kind !== "group" && this.hitHandle(ctx, l, e.screenX, e.screenY)) ctx.setCursor("nwse-resize");
      else ctx.setCursor((ctx.opt<boolean>("autoSelect") || e.ctrlKey) && topmostHit(ctx, e.x, e.y) ? "move" : "default");
      return;
    }
    let tx = e.x - d.start.x;
    let ty = e.y - d.start.y;
    if (e.shiftKey) {
      if (Math.abs(tx) > Math.abs(ty)) ty = 0;
      else tx = 0;
    }
    const target = { x: Math.round(d.start.x + tx), y: Math.round(d.start.y + ty) };
    const dx = target.x - Math.round(d.last.x);
    const dy = target.y - Math.round(d.last.y);
    if (dx === 0 && dy === 0) return;
    d.last = target;
    d.moved = true;
    try {
      ctx.exec(new MoveLayersCommand(ctx.doc, d.ids, dx, dy));
    } catch (err) {
      ctx.notify("info", (err as Error).message);
      this.drag = null;
      return;
    }
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    this.drag = null;
    ctx.setCursor("default");
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || e.ctrlKey || e.metaKey) return false;
    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      default:
        return false;
    }
    const layer = activeLayer(ctx.doc);
    if (!layer) return true;
    const reason = lockReason(layer, "position");
    if (reason) {
      ctx.notify("info", reason);
      return true;
    }
    const ids = this.moveSet(ctx, layer);
    if (ids.length === 0) return true;
    // Each key press is its own history step unless held (repeat merges).
    ctx.exec(new MoveLayersCommand(ctx.doc, ids, dx, dy), { noMerge: !e.repeat });
    ctx.invalidateOverlay();
    return true;
  }

  /** Align the active layer to the selection (if any) or the canvas. */
  align(ctx: ToolContext, kind: AlignKind): void {
    const layer = activeLayer(ctx.doc);
    if (!layer || layer.kind === "group") return;
    const reason = lockReason(layer, "position");
    if (reason) {
      ctx.notify("info", reason);
      return;
    }
    const target = ctx.doc.selection.bbox ?? { x: 0, y: 0, w: ctx.doc.width, h: ctx.doc.height };
    const rect = layerVisualRect(ctx.doc, layer) ?? layerDocRect(ctx.doc, layer);
    const d = alignDelta(rect, target, kind);
    if (d.x === 0 && d.y === 0) return;
    ctx.exec(new MoveLayersCommand(ctx.doc, [layer.id], d.x, d.y), { noMerge: true });
    ctx.invalidateOverlay();
  }

  cancel(): void {
    this.drag = null;
  }

  private handlePoints(ctx: ToolContext, layer: Layer): Point[] | null {
    const r = layerVisualRect(ctx.doc, layer);
    if (!r || r.w <= 0) return null;
    const s = docRectToScreen(ctx.viewport, r);
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    return [
      { x: s.x, y: s.y },
      { x: cx, y: s.y },
      { x: s.x + s.w, y: s.y },
      { x: s.x + s.w, y: cy },
      { x: s.x + s.w, y: s.y + s.h },
      { x: cx, y: s.y + s.h },
      { x: s.x, y: s.y + s.h },
      { x: s.x, y: cy },
    ];
  }

  private hitHandle(ctx: ToolContext, layer: Layer, sx: number, sy: number): boolean {
    const pts = this.handlePoints(ctx, layer);
    return !!pts && pts.some((p) => Math.abs(p.x - sx) <= 6 && Math.abs(p.y - sy) <= 6);
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const layer = activeLayer(ctx.doc);
    if (!layer || layer.kind === "group") return;
    if (!ctx.opt<boolean>("transformControls")) return;
    const r = layerVisualRect(ctx.doc, layer);
    if (!r || r.w <= 0) return;
    const s = docRectToScreen(ctx.viewport, r);
    strokeOutline(g, () => {
      g.beginPath();
      g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
    }, { dash: [] });
    for (const p of this.handlePoints(ctx, layer) ?? []) drawHandle(g, p.x, p.y);
  }
}

/** Topmost visible pixel layer with alpha > 0 under a document point. */
export function topmostHit(ctx: ToolContext, x: number, y: number): Layer | null {
  const layers = ctx.doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (!l.visible || !(l.kind === "raster" || l.kind === "shape" || l.kind === "text")) continue;
    const px = Math.floor(x - l.offset.x);
    const py = Math.floor(y - l.offset.y);
    if (l.raster.getPixel(px, py).a > 8) return l;
  }
  return null;
}
