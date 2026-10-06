/** Move tool (V): drag the active layer; arrow keys nudge 1 px (Shift: 10 px). */
import { Move } from "@lucide/svelte";
import { SetLayerPropsCommand, activeLayer, type LayerId, type Point, type RasterLayer } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { docRectToScreen, strokeOutline } from "./util";
import { layerDocRect } from "$lib/engine";

export class MoveTool implements Tool {
  readonly id = "move";
  readonly name = "Move";
  readonly icon = Move;
  readonly shortcut = "v";
  readonly group = "move";
  readonly groupOrder = 0;
  readonly cursor = "default";
  readonly hint = "Drag to move the active layer. Arrow keys nudge 1 px, Shift+arrows 10 px.";
  readonly options: readonly ToolOption[] = [
    { kind: "toggle", key: "autoSelect", label: "Auto-select layer", default: false },
    { kind: "toggle", key: "showBounds", label: "Show bounds", default: true },
  ];

  private drag: { layerId: LayerId; start: Point; origin: Point } | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (ctx.opt<boolean>("autoSelect")) {
      const hit = topmostHit(ctx, e.x, e.y);
      if (hit) ctx.setActiveLayer(hit.id);
    }
    const layer = activeLayer(ctx.doc);
    if (!layer) return;
    if (layer.locked) {
      ctx.notify("info", `"${layer.name}" is locked.`);
      return;
    }
    if (layer.kind !== "raster") {
      ctx.notify("info", "Groups can't be moved in v1 — move their layers.");
      return;
    }
    this.drag = { layerId: layer.id, start: { x: e.x, y: e.y }, origin: { ...layer.offset } };
    ctx.setCursor("move");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) {
      ctx.setCursor(ctx.opt<boolean>("autoSelect") && topmostHit(ctx, e.x, e.y) ? "move" : "default");
      return;
    }
    let dx = e.x - d.start.x;
    let dy = e.y - d.start.y;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const next = { x: Math.round(d.origin.x + dx), y: Math.round(d.origin.y + dy) };
    const layer = ctx.doc.layers.find((l) => l.id === d.layerId);
    if (!layer || (layer.offset.x === next.x && layer.offset.y === next.y)) return;
    ctx.exec(new SetLayerPropsCommand(d.layerId, { offset: next }, "Move Layer"));
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    this.drag = null;
    ctx.setCursor("default");
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
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
    if (!layer || layer.kind !== "raster" || layer.locked) return true;
    ctx.exec(
      new SetLayerPropsCommand(layer.id, { offset: { x: layer.offset.x + dx, y: layer.offset.y + dy } }, "Nudge Layer"),
      // Each key press is its own history step unless held (repeat merges).
      { noMerge: !e.repeat },
    );
    ctx.invalidateOverlay();
    return true;
  }

  cancel(): void {
    this.drag = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!ctx.opt<boolean>("showBounds")) return;
    const layer = activeLayer(ctx.doc);
    if (!layer || layer.kind !== "raster") return;
    const r = docRectToScreen(ctx.viewport, layerDocRect(ctx.doc, layer));
    strokeOutline(g, () => {
      g.beginPath();
      g.rect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }, { dash: [6, 4] });
  }
}

/** Topmost visible raster layer with alpha > 0 under a document point. */
function topmostHit(ctx: ToolContext, x: number, y: number): RasterLayer | null {
  const layers = ctx.doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (l.kind !== "raster" || !l.visible) continue;
    const px = Math.floor(x - l.offset.x);
    const py = Math.floor(y - l.offset.y);
    if (l.raster.getPixel(px, py).a > 8) return l;
  }
  return null;
}
