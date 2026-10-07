/** Zoom (Z), Hand (H) and Rotate View (R) tools. */
import { ZoomIn, Hand, RotateCw } from "@lucide/svelte";
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
    { kind: "custom", key: "zoomMode", renderer: "icon-select", label: "", default: "in", props: { items: [{ value: "in", icon: "zoom-in", title: "Zoom In" }, { value: "out", icon: "zoom-out", title: "Zoom Out" }] } },
    { kind: "toggle", key: "resize", label: "Resize Windows to Fit", default: false },
    { kind: "toggle", key: "scrubby", label: "Scrubby Zoom", default: true },
    { kind: "button", key: "actual", label: "100%", action: (ctx) => zoomActual(ctx) },
    { kind: "button", key: "fit", label: "Fit Screen", action: (ctx) => zoomFit(ctx) },
    { kind: "button", key: "fill", label: "Fill Screen", action: (ctx) => zoomFill(ctx) },
  ];

  private anchor: Point | null = null;
  private cur: Point | null = null;
  private downScreen: Point | null = null;
  private scrubStart: { x: number; zoom: number; pt: Point } | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.anchor = { x: e.x, y: e.y };
    this.cur = this.anchor;
    this.downScreen = { x: e.screenX, y: e.screenY };
    this.scrubStart = ctx.opt<boolean>("scrubby") ? { x: e.screenX, zoom: ctx.viewport.zoom, pt: { x: e.screenX, y: e.screenY } } : null;
    ctx.setCursor(e.altKey !== (ctx.opt<string>("zoomMode") === "out") ? "zoom-out" : "zoom-in");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (!this.anchor) {
      ctx.setCursor(e.altKey !== (ctx.opt<string>("zoomMode") === "out") ? "zoom-out" : "zoom-in");
      return;
    }
    if (this.scrubStart) {
      const dx = e.screenX - this.scrubStart.x;
      if (Math.abs(dx) > 3) {
        ctx.viewport.setZoomAt(this.scrubStart.pt, this.scrubStart.zoom * Math.exp(dx * 0.01));
        ctx.touch();
        return;
      }
    }
    this.cur = { x: e.x, y: e.y };
    ctx.invalidateOverlay();
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const a = this.anchor;
    const ds = this.downScreen;
    const scrub = this.scrubStart;
    this.anchor = null;
    this.cur = null;
    this.downScreen = null;
    this.scrubStart = null;
    ctx.invalidateOverlay();
    if (!a || !ds) return;
    const vp = ctx.viewport;
    const dragged = Math.hypot(e.screenX - ds.x, e.screenY - ds.y) > 4;
    if (scrub && dragged) return; // scrubby zoom already applied
    const out = e.altKey !== (ctx.opt<string>("zoomMode") === "out");
    if (!dragged) {
      if (out) vp.zoomOut({ x: e.screenX, y: e.screenY });
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
    this.scrubStart = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.anchor || !this.cur || this.scrubStart) return;
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
    { kind: "toggle", key: "scrollAll", label: "Scroll All Windows", default: false },
    { kind: "button", key: "actual", label: "100%", action: (ctx) => zoomActual(ctx) },
    { kind: "button", key: "fit", label: "Fit Screen", action: (ctx) => zoomFit(ctx) },
    { kind: "button", key: "fill", label: "Fill Screen", action: (ctx) => zoomFill(ctx) },
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

/** Rotate View (R): non-destructive viewport rotation around the pointer; Esc / Reset View restores 0°. */
export class RotateViewTool implements Tool {
  readonly id = "rotate-view";
  readonly name = "Rotate View";
  readonly icon = RotateCw;
  readonly shortcut = "r";
  readonly group = "hand";
  readonly groupOrder = 1;
  readonly cursor = "grab";
  readonly hint = "Drag to rotate the view (does not change pixels). Shift snaps to 15°. Esc resets.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "angle", label: "Rotation Angle", min: -180, max: 180, step: 1, default: 0, unit: "°" },
    { kind: "button", key: "reset", label: "Reset View", action: (ctx) => this.reset(ctx) },
  ];

  private center: Point | null = null;
  private startAngle = 0;
  private startRotation = 0;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.center = { x: ctx.viewW / 2, y: ctx.viewH / 2 };
    this.startAngle = Math.atan2(e.screenY - this.center.y, e.screenX - this.center.x);
    this.startRotation = ctx.viewport.rotation;
    ctx.setCursor("grabbing");
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const c = this.center;
    if (!c) {
      // Keep the options-bar angle in sync when rotated elsewhere.
      return;
    }
    let delta = Math.atan2(e.screenY - c.y, e.screenX - c.x) - this.startAngle;
    let target = this.startRotation + delta;
    if (e.shiftKey) target = Math.round(target / (Math.PI / 12)) * (Math.PI / 12);
    delta = target - ctx.viewport.rotation;
    ctx.viewport.rotateAt(c, delta);
    ctx.setOpt("angle", Math.round(((ctx.viewport.rotation * 180) / Math.PI) * 10) / 10);
    ctx.touch();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    this.center = null;
    ctx.setCursor("grab");
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || e.key !== "Escape") return false;
    this.reset(ctx);
    return true;
  }

  reset(ctx: ToolContext): void {
    const c = { x: ctx.viewW / 2, y: ctx.viewH / 2 };
    ctx.viewport.rotateAt(c, -ctx.viewport.rotation);
    ctx.setOpt("angle", 0);
    ctx.touch();
  }

  /** Options-bar angle field → viewport. */
  applyAngle(ctx: ToolContext): void {
    const deg = ctx.opt<number>("angle");
    const c = { x: ctx.viewW / 2, y: ctx.viewH / 2 };
    ctx.viewport.rotateAt(c, (deg * Math.PI) / 180 - ctx.viewport.rotation);
    ctx.touch();
  }

  cancel(): void {
    this.center = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.center) return;
    // Compass: a circle with a north tick showing the rotation.
    const c = this.center;
    g.save();
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c.x, c.y, 28, 0, Math.PI * 2);
    g.stroke();
    const a = ctx.viewport.rotation - Math.PI / 2;
    g.strokeStyle = "#e34850";
    g.beginPath();
    g.moveTo(c.x, c.y);
    g.lineTo(c.x + Math.cos(a) * 26, c.y + Math.sin(a) * 26);
    g.stroke();
    g.restore();
  }
}

export function zoomFit(ctx: ToolContext): void {
  ctx.viewport.fitToView(ctx.viewW, ctx.viewH, ctx.doc.width, ctx.doc.height, 32);
  ctx.touch();
}

export function zoomFill(ctx: ToolContext): void {
  const zoom = Math.max(ctx.viewW / ctx.doc.width, ctx.viewH / ctx.doc.height);
  ctx.viewport.set({ zoom });
  ctx.viewport.centerOn({ x: ctx.doc.width / 2, y: ctx.doc.height / 2 }, ctx.viewW, ctx.viewH);
  ctx.touch();
}

export function zoomActual(ctx: ToolContext): void {
  ctx.viewport.actualPixels(ctx.viewW, ctx.viewH, ctx.doc.width, ctx.doc.height);
  ctx.touch();
}
