/**
 * Select ▸ Transform Selection: a hidden tool that shows a bounding box with 8 handles
 * around the selection; drag inside to move, handles to scale (Shift = keep aspect, Alt =
 * from centre), outside corners to rotate. Enter commits (resamples the mask), Esc cancels.
 */
import { SquareDashedMousePointer } from "@lucide/svelte";
import { Rect, Selection, SetSelectionCommand, type Point } from "$lib/engine";
import { Mat, affineResample } from "$lib/filters/transform/affine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { drawHandle, strokeOutline } from "./util";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: { id: Handle; hx: number; hy: number }[] = [
  { id: "nw", hx: -1, hy: -1 },
  { id: "n", hx: 0, hy: -1 },
  { id: "ne", hx: 1, hy: -1 },
  { id: "e", hx: 1, hy: 0 },
  { id: "se", hx: 1, hy: 1 },
  { id: "s", hx: 0, hy: 1 },
  { id: "sw", hx: -1, hy: 1 },
  { id: "w", hx: -1, hy: 0 },
];

export interface SelTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** Degrees clockwise. */
  angle: number;
}

/** Doc-space matrix mapping the original bbox-local pixel (0..w, 0..h) to its transformed position. */
export function selTransformMatrix(bb: Rect, p: SelTransform): Mat {
  const cx = bb.x + bb.w / 2 + p.tx;
  const cy = bb.y + bb.h / 2 + p.ty;
  return Mat.chain(Mat.translate(-bb.w / 2, -bb.h / 2), Mat.scale(p.sx, p.sy), Mat.rotate((p.angle * Math.PI) / 180), Mat.translate(cx, cy));
}

/** Apply the transform to a selection (bilinear resample of the coverage mask). */
export function transformSelection(sel: Selection, bb: Rect, p: SelTransform): Selection {
  const lum = sel.toLuminanceMask().crop(bb);
  const m = selTransformMatrix(bb, p);
  const out = affineResample(lum, m, Rect.ofSize(sel.width, sel.height));
  const next = new Selection(sel.width, sel.height);
  const d = out.data;
  for (let i = 0, q = 0; i < next.mask.length; i++, q += 4) next.mask[i] = d[q + 3] === 0 ? 0 : d[q]!;
  return next;
}

export class TransformSelectionTool implements Tool {
  readonly id = "transform-selection";
  readonly name = "Transform Selection";
  readonly icon = SquareDashedMousePointer;
  readonly shortcut = "";
  readonly cursor = "default";
  readonly hint = "Drag inside to move, handles to scale (Shift keeps proportions), outside a corner to rotate. Enter commits, Esc cancels.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "x", label: "X", min: -100000, max: 100000, step: 1, default: 0, unit: "px", slider: false },
    { kind: "number", key: "y", label: "Y", min: -100000, max: 100000, step: 1, default: 0, unit: "px", slider: false },
    { kind: "number", key: "w", label: "W", min: 0.1, max: 10000, step: 0.1, default: 100, unit: "%", slider: false },
    { kind: "number", key: "h", label: "H", min: 0.1, max: 10000, step: 0.1, default: 100, unit: "%", slider: false },
    { kind: "number", key: "angle", label: "Angle", min: -360, max: 360, step: 0.1, default: 0, unit: "°", slider: false },
    { kind: "button", key: "commit", label: "Commit", primary: true, action: (ctx) => this.commit(ctx) },
    { kind: "button", key: "cancel", label: "Cancel", action: (ctx) => this.cancel(ctx) },
  ];

  private original: Selection | null = null;
  private bb: Rect | null = null;
  private params: SelTransform = { tx: 0, ty: 0, sx: 1, sy: 1, angle: 0 };
  private returnTool = "marquee-rect";
  private drag: { mode: "move" | "scale" | "rotate"; handle?: { hx: number; hy: number }; start: Point; startParams: SelTransform; startAngle: number } | null = null;

  begin(ctx: ToolContext, returnTool: string): boolean {
    const sel = ctx.doc.selection;
    if (sel.isEmpty || !sel.bbox) return false;
    this.original = sel;
    this.bb = sel.bbox;
    this.params = { tx: 0, ty: 0, sx: 1, sy: 1, angle: 0 };
    this.returnTool = returnTool;
    this.syncOptions(ctx);
    return true;
  }

  private syncOptions(ctx: ToolContext): void {
    const p = this.params;
    ctx.setOpt("x", Math.round(p.tx));
    ctx.setOpt("y", Math.round(p.ty));
    ctx.setOpt("w", Math.round(p.sx * 1000) / 10);
    ctx.setOpt("h", Math.round(p.sy * 1000) / 10);
    ctx.setOpt("angle", Math.round(p.angle * 10) / 10);
  }

  /** Read back the options bar (user typed values). */
  private readOptions(ctx: ToolContext): void {
    const p = this.params;
    const x = ctx.opt<number>("x");
    const y = ctx.opt<number>("y");
    const w = ctx.opt<number>("w") / 100;
    const h = ctx.opt<number>("h") / 100;
    const a = ctx.opt<number>("angle");
    if (Math.round(p.tx) !== x || Math.round(p.ty) !== y || Math.abs(p.sx - w) > 1e-3 || Math.abs(p.sy - h) > 1e-3 || Math.abs(p.angle - a) > 0.05) {
      this.params = { tx: x, ty: y, sx: w, sy: h, angle: a };
    }
  }

  corners(ctx: ToolContext): Point[] {
    const bb = this.bb!;
    const m = selTransformMatrix(bb, this.params);
    return [Mat.apply(m, { x: 0, y: 0 }), Mat.apply(m, { x: bb.w, y: 0 }), Mat.apply(m, { x: bb.w, y: bb.h }), Mat.apply(m, { x: 0, y: bb.h })].map((p) => ctx.viewport.docToScreen(p));
  }

  private handlePos(c: Point[], hx: number, hy: number): Point {
    const u = (hx + 1) / 2;
    const v = (hy + 1) / 2;
    const top = { x: c[0]!.x + (c[1]!.x - c[0]!.x) * u, y: c[0]!.y + (c[1]!.y - c[0]!.y) * u };
    const bot = { x: c[3]!.x + (c[2]!.x - c[3]!.x) * u, y: c[3]!.y + (c[2]!.y - c[3]!.y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  }

  private hit(ctx: ToolContext, sx: number, sy: number): { mode: "move" | "scale" | "rotate"; handle?: { hx: number; hy: number } } | null {
    if (!this.bb) return null;
    const c = this.corners(ctx);
    for (const h of HANDLES) {
      const p = this.handlePos(c, h.hx, h.hy);
      if (Math.abs(p.x - sx) <= 6 && Math.abs(p.y - sy) <= 6) return { mode: "scale", handle: { hx: h.hx, hy: h.hy } };
    }
    if (pointInQuad({ x: sx, y: sy }, c)) return { mode: "move" };
    for (const h of HANDLES) {
      if (h.hx === 0 || h.hy === 0) continue;
      const p = this.handlePos(c, h.hx, h.hy);
      if (Math.hypot(p.x - sx, p.y - sy) <= 24) return { mode: "rotate" };
    }
    return null;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0 || !this.bb) return;
    this.readOptions(ctx);
    const h = this.hit(ctx, e.screenX, e.screenY);
    if (!h) return;
    const c = this.corners(ctx);
    const cx = (c[0]!.x + c[2]!.x) / 2;
    const cy = (c[0]!.y + c[2]!.y) / 2;
    this.drag = { mode: h.mode, ...(h.handle ? { handle: h.handle } : {}), start: { x: e.x, y: e.y }, startParams: { ...this.params }, startAngle: Math.atan2(e.screenY - cy, e.screenX - cx) };
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const d = this.drag;
    if (!d) {
      const h = this.hit(ctx, e.screenX, e.screenY);
      ctx.setCursor(h?.mode === "move" ? "move" : h?.mode === "scale" ? "nwse-resize" : h?.mode === "rotate" ? "alias" : "default");
      return;
    }
    const bb = this.bb!;
    const sp = d.startParams;
    if (d.mode === "move") {
      this.params = { ...sp, tx: sp.tx + (e.x - d.start.x), ty: sp.ty + (e.y - d.start.y) };
    } else if (d.mode === "rotate") {
      const c = this.corners(ctx);
      const cx = (c[0]!.x + c[2]!.x) / 2;
      const cy = (c[0]!.y + c[2]!.y) / 2;
      let deg = ((Math.atan2(e.screenY - cy, e.screenX - cx) - d.startAngle) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      this.params = { ...sp, angle: sp.angle + deg };
    } else if (d.handle) {
      // Scale: express the drag in the box's local (rotated) frame.
      const rad = (-sp.angle * Math.PI) / 180;
      const dx = e.x - d.start.x;
      const dy = e.y - d.start.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const w0 = bb.w * sp.sx;
      const h0 = bb.h * sp.sy;
      const k = e.altKey ? 2 : 1;
      let sx = d.handle.hx === 0 ? sp.sx : Math.max(0.01, (w0 + d.handle.hx * lx * k) / bb.w);
      let sy = d.handle.hy === 0 ? sp.sy : Math.max(0.01, (h0 + d.handle.hy * ly * k) / bb.h);
      if (e.shiftKey && d.handle.hx !== 0 && d.handle.hy !== 0) {
        const r = Math.max(sx / sp.sx, sy / sp.sy);
        sx = sp.sx * r;
        sy = sp.sy * r;
      }
      let tx = sp.tx;
      let ty = sp.ty;
      if (!e.altKey) {
        // Keep the opposite edge fixed: shift the centre by half the size change (in the rotated frame).
        const ddx = ((sx - sp.sx) * bb.w * d.handle.hx) / 2;
        const ddy = ((sy - sp.sy) * bb.h * d.handle.hy) / 2;
        const ra = (sp.angle * Math.PI) / 180;
        tx += ddx * Math.cos(ra) - ddy * Math.sin(ra);
        ty += ddx * Math.sin(ra) + ddy * Math.cos(ra);
      }
      this.params = { ...sp, sx, sy, tx, ty };
    }
    this.syncOptions(ctx);
    ctx.invalidateOverlay();
  }

  onPointerUp(): void {
    this.drag = null;
  }

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down") return false;
    if (e.key === "Enter") {
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
    this.readOptions(ctx);
    const orig = this.original;
    const bb = this.bb;
    if (orig && bb) {
      const p = this.params;
      if (p.tx !== 0 || p.ty !== 0 || p.sx !== 1 || p.sy !== 1 || p.angle !== 0) {
        ctx.exec(new SetSelectionCommand(transformSelection(orig, bb, p), "Transform Selection"));
      }
    }
    this.finish(ctx);
  }

  cancel(ctx: ToolContext): void {
    this.finish(ctx);
  }

  private finish(ctx: ToolContext): void {
    this.original = null;
    this.bb = null;
    this.drag = null;
    ctx.invalidateOverlay();
    if (ctx.entry && this.returnTool) ctx.selectTool(this.returnTool);
  }

  onDeactivate(): void {
    this.original = null;
    this.bb = null;
    this.drag = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.bb) return;
    const c = this.corners(ctx);
    strokeOutline(g, () => {
      g.beginPath();
      g.moveTo(c[0]!.x, c[0]!.y);
      for (let i = 1; i < 4; i++) g.lineTo(c[i]!.x, c[i]!.y);
      g.closePath();
    }, { dash: [] });
    for (const h of HANDLES) {
      const p = this.handlePos(c, h.hx, h.hy);
      drawHandle(g, p.x, p.y);
    }
    const cx = (c[0]!.x + c[2]!.x) / 2;
    const cy = (c[0]!.y + c[2]!.y) / 2;
    g.save();
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, 3, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
}

function pointInQuad(p: Point, q: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const s = Math.sign(cross);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
