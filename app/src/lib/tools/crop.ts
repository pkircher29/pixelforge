/** Crop (C): drag a rect, adjust with handles, Enter commits. */
import { Crop } from "@lucide/svelte";
import { CropCanvasCommand, Rect, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { clampDocRect, docRectToScreen, drawHandle, strokeOutline } from "./util";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export class CropTool implements Tool {
  readonly id = "crop";
  readonly name = "Crop";
  readonly icon = Crop;
  readonly shortcut = "c";
  readonly cursor = "crosshair";
  readonly hint = "Drag the area to keep. Enter crops, Esc cancels.";
  readonly options: readonly ToolOption[] = [
    { kind: "toggle", key: "thirds", label: "Rule of thirds", default: true },
    { kind: "button", key: "commit", label: "Crop", primary: true, action: (ctx) => this.commit(ctx) },
    { kind: "button", key: "cancel", label: "Cancel", action: (ctx) => this.cancel(ctx) },
  ];

  /** Current crop rect in doc space (fractional while dragging). */
  rect: Rect | null = null;
  private drag:
    | { kind: "new"; anchor: Point }
    | { kind: "move"; start: Point; origin: Rect }
    | { kind: "handle"; handle: Handle; origin: Rect }
    | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const p = { x: e.x, y: e.y };
    if (this.rect) {
      const h = this.hitHandle(ctx, e.screenX, e.screenY);
      if (h) {
        this.drag = { kind: "handle", handle: h, origin: { ...this.rect } };
        return;
      }
      if (Rect.containsPoint(this.rect, p.x, p.y)) {
        this.drag = { kind: "move", start: p, origin: { ...this.rect } };
        ctx.setCursor("move");
        return;
      }
    }
    this.drag = { kind: "new", anchor: p };
    this.rect = Rect.make(p.x, p.y, 0, 0);
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) {
      if (this.rect) {
        const h = this.hitHandle(ctx, e.screenX, e.screenY);
        ctx.setCursor(h ? CURSORS[h] : Rect.containsPoint(this.rect, e.x, e.y) ? "move" : "crosshair");
      }
      return;
    }
    const docBounds = Rect.ofSize(ctx.doc.width, ctx.doc.height);
    if (d.kind === "new") {
      let r = Rect.fromPoints(d.anchor, { x: e.x, y: e.y });
      if (e.shiftKey) {
        const m = Math.max(r.w, r.h);
        r = Rect.fromPoints(d.anchor, {
          x: d.anchor.x + Math.sign(e.x - d.anchor.x || 1) * m,
          y: d.anchor.y + Math.sign(e.y - d.anchor.y || 1) * m,
        });
      }
      this.rect = Rect.intersect(r, docBounds);
    } else if (d.kind === "move") {
      const dx = e.x - d.start.x;
      const dy = e.y - d.start.y;
      const x = Math.max(0, Math.min(ctx.doc.width - d.origin.w, d.origin.x + dx));
      const y = Math.max(0, Math.min(ctx.doc.height - d.origin.h, d.origin.y + dy));
      this.rect = Rect.make(x, y, d.origin.w, d.origin.h);
    } else {
      const o = d.origin;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      if (d.handle.includes("w")) x0 = Math.min(e.x, x1 - 1);
      if (d.handle.includes("e")) x1 = Math.max(e.x, x0 + 1);
      if (d.handle.includes("n")) y0 = Math.min(e.y, y1 - 1);
      if (d.handle.includes("s")) y1 = Math.max(e.y, y0 + 1);
      this.rect = Rect.intersect(Rect.make(x0, y0, x1 - x0, y1 - y0), docBounds);
    }
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    if (!this.drag) return;
    this.drag = null;
    if (this.rect) {
      const r = clampDocRect(ctx.doc, this.rect);
      this.rect = Rect.isEmpty(r) || r.w < 2 || r.h < 2 ? null : r;
    }
    ctx.setCursor("crosshair");
    ctx.invalidateOverlay();
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "Enter" && this.rect) {
      this.commit(ctx);
      return true;
    }
    if (e.key === "Escape" && this.rect) {
      this.cancel(ctx);
      return true;
    }
    return false;
  }

  commit(ctx: ToolContext): void {
    if (!this.rect) {
      ctx.notify("info", "Drag the area to keep first.");
      return;
    }
    const r = clampDocRect(ctx.doc, this.rect);
    this.rect = null;
    this.drag = null;
    if (Rect.isEmpty(r)) return;
    if (r.w === ctx.doc.width && r.h === ctx.doc.height) {
      ctx.invalidateOverlay();
      return;
    }
    ctx.exec(new CropCanvasCommand(r));
    ctx.compositor?.invalidateAll();
    ctx.invalidateOverlay();
    ctx.notify("success", `Cropped to ${r.w} × ${r.h}`);
  }

  cancel(ctx: ToolContext): void {
    this.rect = null;
    this.drag = null;
    ctx.invalidateOverlay();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  private handlePoints(ctx: ToolContext): Record<Handle, Point> | null {
    if (!this.rect) return null;
    const s = docRectToScreen(ctx.viewport, this.rect);
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    return {
      nw: { x: s.x, y: s.y },
      n: { x: cx, y: s.y },
      ne: { x: s.x + s.w, y: s.y },
      e: { x: s.x + s.w, y: cy },
      se: { x: s.x + s.w, y: s.y + s.h },
      s: { x: cx, y: s.y + s.h },
      sw: { x: s.x, y: s.y + s.h },
      w: { x: s.x, y: cy },
    };
  }

  private hitHandle(ctx: ToolContext, sx: number, sy: number): Handle | null {
    const pts = this.handlePoints(ctx);
    if (!pts) return null;
    for (const h of HANDLES) {
      const p = pts[h];
      if (Math.abs(p.x - sx) <= 6 && Math.abs(p.y - sy) <= 6) return h;
    }
    return null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.rect) return;
    const s = docRectToScreen(ctx.viewport, this.rect);
    // Dim everything outside the crop.
    g.save();
    g.fillStyle = "rgba(6, 8, 12, 0.6)";
    g.beginPath();
    g.rect(0, 0, ctx.viewW, ctx.viewH);
    g.rect(s.x, s.y, s.w, s.h);
    g.fill("evenodd");
    g.restore();
    strokeOutline(g, () => {
      g.beginPath();
      g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
    }, { dash: [] });
    if (ctx.opt<boolean>("thirds") && s.w > 40 && s.h > 40) {
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < 3; i++) {
        const x = Math.round(s.x + (s.w * i) / 3) + 0.5;
        const y = Math.round(s.y + (s.h * i) / 3) + 0.5;
        g.moveTo(x, s.y);
        g.lineTo(x, s.y + s.h);
        g.moveTo(s.x, y);
        g.lineTo(s.x + s.w, y);
      }
      g.stroke();
      g.restore();
    }
    const pts = this.handlePoints(ctx)!;
    for (const h of HANDLES) drawHandle(g, pts[h].x, pts[h].y);
    const r = clampDocRect(ctx.doc, this.rect);
    const label = `${r.w} × ${r.h}`;
    g.save();
    g.font = "11px Cascadia Code, Consolas, monospace";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(10,12,17,0.85)";
    g.fillRect(s.x, s.y - 22, tw, 18);
    g.fillStyle = "#e9ecf3";
    g.fillText(label, s.x + 5, s.y - 9);
    g.restore();
  }
}
