/**
 * Crop (C): PS-style overlay — dimmed outside, rule-of-thirds grid, 8 handles, aspect
 * presets, straighten (drag a line with the Straighten button armed or Ctrl held), and
 * "Delete Cropped Pixels". Enter commits, Esc cancels.
 */
import { Crop } from "@lucide/svelte";
import { CropCanvasCommand, Rect, type Point } from "$lib/engine";
import { RotateCanvasCommand } from "$lib/filters/transform/commands";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { clampDocRect, docRectToScreen, drawHandle, strokeOutline } from "./util";
import { measureLine, straightenAngle } from "./measure";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

export const ASPECT_PRESETS = [
  { value: "free", label: "Ratio" },
  { value: "original", label: "Original Ratio" },
  { value: "1:1", label: "1 : 1 (Square)" },
  { value: "4:5", label: "4 : 5 (8 : 10)" },
  { value: "5:7", label: "5 : 7" },
  { value: "2:3", label: "2 : 3 (4 : 6)" },
  { value: "16:9", label: "16 : 9" },
  { value: "custom", label: "W x H" },
] as const;

/** Constrain a drag rect to a ratio (w/h) keeping the anchor corner. */
export function constrainRatio(anchor: Point, cur: Point, ratio: number): Rect {
  const dx = cur.x - anchor.x;
  const dy = cur.y - anchor.y;
  const w = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
  const h = w / ratio;
  return Rect.make(dx < 0 ? anchor.x - w : anchor.x, dy < 0 ? anchor.y - h : anchor.y, w, h);
}

export class CropTool implements Tool {
  readonly id = "crop";
  readonly name = "Crop";
  readonly icon = Crop;
  readonly shortcut = "c";
  readonly group = "crop";
  readonly groupOrder = 0;
  readonly cursor = "crosshair";
  readonly hint = "Drag the area to keep; drag handles to adjust. Enter crops, Esc cancels. Ctrl-drag a line to straighten.";
  readonly options: readonly ToolOption[] = [
    { kind: "select", key: "aspect", label: "", choices: ASPECT_PRESETS.map((p) => ({ value: p.value, label: p.label })), default: "free" },
    { kind: "number", key: "ratioW", label: "", min: 0.01, max: 100000, step: 1, default: 1, slider: false },
    { kind: "number", key: "ratioH", label: "", min: 0.01, max: 100000, step: 1, default: 1, slider: false },
    { kind: "button", key: "swap", label: "⇄", action: (ctx) => this.swapRatio(ctx) },
    { kind: "button", key: "straightenBtn", label: "Straighten", action: (ctx) => this.armStraighten(ctx) },
    {
      kind: "select",
      key: "overlay",
      label: "",
      choices: [
        { value: "thirds", label: "Rule of Thirds" },
        { value: "grid", label: "Grid" },
        { value: "none", label: "Never Show Overlay" },
      ],
      default: "thirds",
    },
    { kind: "toggle", key: "deletePixels", label: "Delete Cropped Pixels", default: true },
    { kind: "button", key: "cancel", label: "Cancel", action: (ctx) => this.cancel(ctx) },
    { kind: "button", key: "commit", label: "Commit", primary: true, action: (ctx) => this.commit(ctx) },
  ];

  /** Current crop rect in doc space (fractional while dragging). */
  rect: Rect | null = null;
  private drag: { kind: "new"; anchor: Point } | { kind: "move"; start: Point; origin: Rect } | { kind: "handle"; handle: Handle; origin: Rect } | { kind: "straighten"; a: Point; b: Point } | null = null;
  private straightenArmed = false;

  private ratio(ctx: ToolContext): number | null {
    const a = ctx.opt<string>("aspect");
    if (a === "free") return null;
    if (a === "original") return ctx.doc.width / ctx.doc.height;
    if (a === "custom") return Math.max(0.01, ctx.opt<number>("ratioW")) / Math.max(0.01, ctx.opt<number>("ratioH"));
    const [w, h] = a.split(":").map(Number);
    return w && h ? w / h : null;
  }

  private swapRatio(ctx: ToolContext): void {
    const w = ctx.opt<number>("ratioW");
    ctx.setOpt("ratioW", ctx.opt<number>("ratioH"));
    ctx.setOpt("ratioH", w);
    if (ctx.opt<string>("aspect") !== "custom" && ctx.opt<string>("aspect") !== "free") {
      const [a, b] = ctx.opt<string>("aspect").split(":");
      if (a && b) {
        ctx.setOpt("aspect", "custom");
        ctx.setOpt("ratioW", Number(b));
        ctx.setOpt("ratioH", Number(a));
      }
    }
  }

  private armStraighten(ctx: ToolContext): void {
    this.straightenArmed = true;
    ctx.hint("Drag a line along an edge that should be horizontal or vertical.");
    ctx.setCursor("crosshair");
  }

  onActivate(ctx: ToolContext): void {
    // PS shows the whole canvas as the initial crop box.
    this.rect = Rect.ofSize(ctx.doc.width, ctx.doc.height);
    ctx.invalidateOverlay();
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const p = { x: e.x, y: e.y };
    if (this.straightenArmed || e.ctrlKey) {
      this.drag = { kind: "straighten", a: p, b: p };
      ctx.invalidateOverlay();
      return;
    }
    if (this.rect) {
      const h = this.hitHandle(ctx, e.screenX, e.screenY);
      if (h) {
        this.drag = { kind: "handle", handle: h, origin: { ...this.rect } };
        return;
      }
      if (Rect.containsPoint(this.rect, p.x, p.y) && !Rect.equals(this.rect, Rect.ofSize(ctx.doc.width, ctx.doc.height))) {
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
        ctx.setCursor(this.straightenArmed ? "crosshair" : h ? CURSORS[h] : Rect.containsPoint(this.rect, e.x, e.y) ? "move" : "crosshair");
      }
      return;
    }
    const docBounds = Rect.ofSize(ctx.doc.width, ctx.doc.height);
    if (d.kind === "straighten") {
      d.b = { x: e.x, y: e.y };
      ctx.invalidateOverlay();
      return;
    }
    const ratio = this.ratio(ctx);
    if (d.kind === "new") {
      let r: Rect;
      if (ratio) r = constrainRatio(d.anchor, { x: e.x, y: e.y }, ratio);
      else if (e.shiftKey) r = constrainRatio(d.anchor, { x: e.x, y: e.y }, 1);
      else r = Rect.fromPoints(d.anchor, { x: e.x, y: e.y });
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
      const r2 = ratio ?? (e.shiftKey ? o.w / o.h : null);
      if (r2 && d.handle.length === 2) {
        // Corner handles keep the ratio: derive height from width.
        const w = x1 - x0;
        const h = w / r2;
        if (d.handle.includes("n")) y0 = y1 - h;
        else y1 = y0 + h;
      }
      this.rect = Rect.intersect(Rect.make(x0, y0, x1 - x0, y1 - y0), docBounds);
    }
    ctx.invalidateOverlay();
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.kind === "straighten") {
      this.straightenArmed = false;
      const m = measureLine(d.a.x, d.a.y, d.b.x, d.b.y);
      if (m.length >= 4) {
        const deg = straightenAngle(m);
        if (Math.abs(deg) > 0.01) {
          ctx.exec(new RotateCanvasCommand(deg), { noMerge: true });
          ctx.compositor?.invalidateAll();
          ctx.notify("success", `Straightened by ${deg.toFixed(2)}°`);
        }
      }
      this.rect = Rect.ofSize(ctx.doc.width, ctx.doc.height);
      ctx.hint(this.hint);
      ctx.invalidateOverlay();
      return;
    }
    if (this.rect) {
      const r = clampDocRect(ctx.doc, this.rect);
      this.rect = Rect.isEmpty(r) || r.w < 2 || r.h < 2 ? Rect.ofSize(ctx.doc.width, ctx.doc.height) : r;
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
    if (e.key === "Escape") {
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
    this.drag = null;
    if (Rect.isEmpty(r)) return;
    if (r.w === ctx.doc.width && r.h === ctx.doc.height) {
      ctx.invalidateOverlay();
      return;
    }
    // "Delete Cropped Pixels" off would keep pixels outside the canvas; v1 layer buffers are
    // canvas-sized, so both modes crop the buffers (documented limitation).
    ctx.exec(new CropCanvasCommand(r));
    ctx.compositor?.invalidateAll();
    this.rect = Rect.ofSize(ctx.doc.width, ctx.doc.height);
    ctx.invalidateOverlay();
    ctx.notify("success", `Cropped to ${r.w} × ${r.h}`);
  }

  cancel(ctx: ToolContext): void {
    this.rect = Rect.ofSize(ctx.doc.width, ctx.doc.height);
    this.drag = null;
    this.straightenArmed = false;
    ctx.invalidateOverlay();
  }

  onDeactivate(ctx: ToolContext): void {
    this.rect = null;
    this.drag = null;
    this.straightenArmed = false;
    ctx.invalidateOverlay();
  }

  private handlePoints(ctx: ToolContext): Record<Handle, Point> | null {
    if (!this.rect) return null;
    const s = docRectToScreen(ctx.viewport, this.rect);
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    return { nw: { x: s.x, y: s.y }, n: { x: cx, y: s.y }, ne: { x: s.x + s.w, y: s.y }, e: { x: s.x + s.w, y: cy }, se: { x: s.x + s.w, y: s.y + s.h }, s: { x: cx, y: s.y + s.h }, sw: { x: s.x, y: s.y + s.h }, w: { x: s.x, y: cy } };
  }

  private hitHandle(ctx: ToolContext, sx: number, sy: number): Handle | null {
    const pts = this.handlePoints(ctx);
    if (!pts) return null;
    for (const h of HANDLES) {
      const p = pts[h];
      if (Math.abs(p.x - sx) <= 7 && Math.abs(p.y - sy) <= 7) return h;
    }
    return null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const d = this.drag;
    if (d?.kind === "straighten") {
      const a = ctx.viewport.docToScreen(d.a);
      const b = ctx.viewport.docToScreen(d.b);
      g.save();
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      const m = measureLine(d.a.x, d.a.y, d.b.x, d.b.y);
      g.font = "11px Segoe UI, sans-serif";
      g.fillStyle = "rgba(30,30,30,0.9)";
      g.fillRect(b.x + 8, b.y - 22, 70, 18);
      g.fillStyle = "#e6e6e6";
      g.fillText(`${m.angle.toFixed(1)}°`, b.x + 13, b.y - 9);
      g.restore();
      return;
    }
    if (!this.rect) return;
    const s = docRectToScreen(ctx.viewport, this.rect);
    g.save();
    g.fillStyle = "rgba(0, 0, 0, 0.55)";
    g.beginPath();
    g.rect(0, 0, ctx.viewW, ctx.viewH);
    g.rect(s.x, s.y, s.w, s.h);
    g.fill("evenodd");
    g.restore();
    strokeOutline(g, () => {
      g.beginPath();
      g.rect(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5, Math.round(s.w), Math.round(s.h));
    }, { dash: [] });
    const overlay = ctx.opt<string>("overlay");
    if (overlay !== "none" && s.w > 40 && s.h > 40) {
      const n = overlay === "grid" ? Math.max(3, Math.round(s.w / 40)) : 3;
      const ny = overlay === "grid" ? Math.max(3, Math.round(s.h / 40)) : 3;
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.4)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < n; i++) {
        const x = Math.round(s.x + (s.w * i) / n) + 0.5;
        g.moveTo(x, s.y);
        g.lineTo(x, s.y + s.h);
      }
      for (let i = 1; i < ny; i++) {
        const y = Math.round(s.y + (s.h * i) / ny) + 0.5;
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
    g.font = "11px Segoe UI, sans-serif";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(30,30,30,0.9)";
    g.fillRect(s.x, s.y - 22, tw, 18);
    g.fillStyle = "#e6e6e6";
    g.fillText(label, s.x + 5, s.y - 9);
    g.restore();
  }
}
