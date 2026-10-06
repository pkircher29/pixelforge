/** Zoom (Z) and Hand (H) tools. */
import { ZoomIn, Hand } from "@lucide/svelte";
import { Rect, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { docRectToScreen, strokeOutline } from "./util";

export class ZoomTool implements Tool {
  readonly id = "zoom";
  readonly name = "Zoom";
  readonly icon = ZoomIn;
  readonly shortcut = "z";
  readonly group = "zoom";
  readonly groupOrder = 0;
  readonly cursor = "zoom-in";
  readonly hint = "Click to zoom in, Alt-click to zoom out, drag a rectangle to zoom to it.";
  readonly options: readonly ToolOption[] = [
    { kind: "button", key: "fit", label: "Fit", action: (ctx) => zoomFit(ctx) },
    { kind: "button", key: "actual", label: "100%", action: (ctx) => zoomActual(ctx) },
  ];

  private anchor: Point | null = null;
  private cur: Point | null = null;
  private downScreen: Point | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    this.downScreen = { x: e.screenX, y: e.screenY };
    ctx.setCursor(e.altKey ? "zoom-out" : "zoom-in");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.anchor) {
      ctx.setCursor(e.altKey ? "zoom-out" : "zoom-in");
      return;
    }
    this.cur = { x: e.x, y: e.y };
    ctx.invalidateOverlay();
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const a = this.anchor;
    const ds = this.downScreen;
    this.anchor = null;
    this.cur = null;
    this.downScreen = null;
    ctx.invalidateOverlay();
    if (!a || !ds) return;
    const vp = ctx.viewport;
    const dragged = Math.hypot(e.screenX - ds.x, e.screenY - ds.y) > 4;
    if (!dragged) {
      if (e.altKey) vp.zoomOut({ x: e.screenX, y: e.screenY });
      else vp.zoomIn({ x: e.screenX, y: e.screenY });
    } else {
      const r = Rect.fromPoints(a, { x: e.x, y: e.y });
      if (r.w < 1 || r.h < 1) return;
      const zoom = Math.min(ctx.viewW / r.w, ctx.viewH / r.h);
      vp.set({ zoom });
      vp.centerOn({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, ctx.viewW, ctx.viewH);
    }
    ctx.touch();
  }

  cancel(ctx: ToolContext): void {
    this.anchor = null;
    this.cur = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.anchor || !this.cur) return;
    const s = docRectToScreen(ctx.viewport, Rect.fromPoints(this.anchor, this.cur));
    if (s.w < 2 && s.h < 2) return;
    strokeOutline(g, () => {
      g.beginPath();
      g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
    });
  }
}

export class HandTool implements Tool {
  readonly id = "hand";
  readonly name = "Hand";
  readonly icon = Hand;
  readonly shortcut = "h";
  readonly group = "hand";
  readonly groupOrder = 0;
  readonly cursor = "grab";
  readonly hint = "Drag to pan. Hold Space with any tool to pan temporarily.";
  readonly options: readonly ToolOption[] = [
    { kind: "button", key: "fit", label: "Fit", action: (ctx) => zoomFit(ctx) },
    { kind: "button", key: "actual", label: "100%", action: (ctx) => zoomActual(ctx) },
  ];

  private last: Point | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0 && e.button !== 1) return;
    this.last = { x: e.screenX, y: e.screenY };
    ctx.setCursor("grabbing");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.last) return;
    ctx.viewport.panBy(e.screenX - this.last.x, e.screenY - this.last.y);
    this.last = { x: e.screenX, y: e.screenY };
    ctx.touch();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    this.last = null;
    ctx.setCursor("grab");
  }

  cancel(): void {
    this.last = null;
  }
}

export function zoomFit(ctx: ToolContext): void {
  ctx.viewport.fitToView(ctx.viewW, ctx.viewH, ctx.doc.width, ctx.doc.height, 32);
  ctx.touch();
}

export function zoomActual(ctx: ToolContext): void {
  ctx.viewport.actualPixels(ctx.viewW, ctx.viewH, ctx.doc.width, ctx.doc.height);
  ctx.touch();
}
