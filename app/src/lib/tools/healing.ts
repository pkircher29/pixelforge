/** Spot Healing Brush (J), Healing Brush, Patch and Red Eye. */
import { Bandage, Eye, Scissors, Sparkle } from "@lucide/svelte";
import { PaintCommand, Raster, Rect, Selection, SetSelectionCommand, compositeToRaster, type Point } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { BrushStroke, type StrokeBlend } from "./brush-engine";
import { BRUSH_PICKER_OPTION, BrushBasedTool, SAMPLE_OPTION } from "./brush-base";
import { resolvePaintTarget, type PaintTarget } from "./paint-target";
import { findHealSource, healRegion, maskBounds, maskFromBytes, ringMask } from "./heal";
import { fixRedEye, isRedEyePixel } from "./retouch-math";
import { strokeOutline } from "./util";
import { combineSelection, modeFromModifiers } from "./selection-mod";
import type { SelectionMode } from "./types";

/**
 * Spot Healing: the stroke only accumulates coverage (painting the snapshot back, i.e.
 * visually nothing changes) and the heal is applied once at pointer-up over the whole
 * covered region, like Photoshop.
 */
export class SpotHealingTool extends BrushBasedTool {
  constructor() {
    super({
      id: "healing-spot",
      name: "Spot Healing Brush",
      icon: Sparkle,
      shortcut: "j",
      group: "healing",
      groupOrder: 0,
      hint: "Paint over a blemish: texture from nearby is blended in automatically.",
      label: "Spot Healing Brush",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "type",
          label: "Type",
          choices: [
            { value: "content", label: "Content-Aware" },
            { value: "texture", label: "Create Texture" },
            { value: "proximity", label: "Proximity Match" },
          ],
          default: "content",
        },
        { kind: "toggle", key: "sampleAll", label: "Sample All Layers", default: false },
      ],
    });
  }

  protected override onAltClick(): boolean {
    return false;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget): StrokeBlend | null {
    if (target.kind !== "layer") {
      ctx.notify("info", "The Spot Healing Brush works on pixel layers.");
      return null;
    }
    // Paint a faint highlight so the user sees the covered area; replaced at pointer-up.
    return { mode: "color", color: { r: 128, g: 128, b: 128, a: 90 } };
  }

  protected override opacityOf(): number {
    return 1;
  }

  protected override beforeFinish(ctx: ToolContext, stroke: BrushStroke, target: PaintTarget): void {
    const dirty = stroke.dirtyRect;
    if (!dirty) return;
    // Undo the preview tint, then heal from the snapshot.
    target.raster.blit(stroke.before, dirty.x, dirty.y, dirty, { mode: "replace" });
    const mask = stroke.coverage;
    const w = target.raster.width;
    const h = target.raster.height;
    const bounds = maskBounds(mask, w, h);
    if (!bounds) return;
    const sampleAll = ctx.opt<boolean>("sampleAll");
    const src = sampleAll ? compositeInLayerSpace(ctx, target) : stroke.before;
    const ring = ringMask(mask, w, h, bounds, Math.max(3, Math.round(Math.max(bounds.w, bounds.h) * 0.15)));
    const type = ctx.opt<string>("type");
    const off = findHealSource(src, mask, bounds, ring, type === "proximity" ? { radii: [Math.max(bounds.w, bounds.h) * 1.1] } : {});
    healRegion(target.raster, src, mask, off, { mode: type === "texture" ? "replace" : "normal" });
  }
}

/** Composite of the document in the target layer's raster space. */
function compositeInLayerSpace(ctx: ToolContext, target: PaintTarget): Raster {
  const comp = compositeToRaster(ctx.doc);
  const out = new Raster(target.raster.width, target.raster.height);
  out.blit(comp, -target.offset.x, -target.offset.y, undefined, { mode: "replace" });
  return out;
}

export class HealingBrushTool extends BrushBasedTool {
  private source: Point | null = null;
  private delta: Point | null = null;

  constructor() {
    super({
      id: "healing-brush",
      name: "Healing Brush",
      icon: Bandage,
      shortcut: "j",
      group: "healing",
      groupOrder: 1,
      hint: "Alt-click a source, then paint: the source texture is blended to match the destination's lighting.",
      label: "Healing Brush",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "source",
          label: "Source",
          choices: [
            { value: "sampled", label: "Sampled" },
            { value: "pattern", label: "Pattern" },
          ],
          default: "sampled",
        },
        { kind: "toggle", key: "aligned", label: "Aligned", default: true },
        SAMPLE_OPTION,
      ],
    });
  }

  protected override onAltClick(e: ToolEvent, ctx: ToolContext): boolean {
    this.source = { x: e.x, y: e.y };
    this.delta = null;
    ctx.hint(`Healing source set at ${Math.round(e.x)}, ${Math.round(e.y)}`);
    return true;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    if (target.kind !== "layer") {
      ctx.notify("info", "The Healing Brush works on pixel layers.");
      return null;
    }
    if (!this.source) {
      ctx.notify("info", "Alt-click to set a source first.");
      return null;
    }
    if (!ctx.opt<boolean>("aligned") || !this.delta) this.delta = { x: this.source.x - e.x, y: this.source.y - e.y };
    return { mode: "color", color: { r: 128, g: 128, b: 128, a: 90 } };
  }

  protected override opacityOf(): number {
    return 1;
  }

  protected override beforeFinish(ctx: ToolContext, stroke: BrushStroke, target: PaintTarget): void {
    const dirty = stroke.dirtyRect;
    const delta = this.delta;
    if (!dirty || !delta) return;
    target.raster.blit(stroke.before, dirty.x, dirty.y, dirty, { mode: "replace" });
    const src = ctx.opt<string>("sample") === "all" ? compositeInLayerSpace(ctx, target) : stroke.before;
    healRegion(target.raster, src, stroke.coverage, { x: Math.round(delta.x), y: Math.round(delta.y) });
  }

  protected override drawExtraOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.source) return;
    let p = this.source;
    if (this.stroke && this.delta && this.hover) p = { x: this.hover.x + this.delta.x, y: this.hover.y + this.delta.y };
    const s = ctx.viewport.docToScreen(p);
    g.save();
    g.strokeStyle = "#1473e6";
    g.beginPath();
    g.moveTo(s.x - 7, s.y);
    g.lineTo(s.x + 7, s.y);
    g.moveTo(s.x, s.y - 7);
    g.lineTo(s.x, s.y + 7);
    g.stroke();
    g.restore();
  }
}

/** Patch: lasso a region, then drag it to the source (Source mode) or destination. */
export class PatchTool implements Tool {
  readonly id = "patch";
  readonly name = "Patch";
  readonly icon = Scissors;
  readonly shortcut = "j";
  readonly group = "healing";
  readonly groupOrder = 2;
  readonly cursor = "crosshair";
  readonly hint = "Lasso the area to fix, then drag the selection to the area to sample from (Source mode).";
  readonly options: readonly ToolOption[] = [
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
    {
      kind: "select",
      key: "patch",
      label: "Patch",
      choices: [
        { value: "source", label: "Source" },
        { value: "destination", label: "Destination" },
      ],
      default: "source",
    },
    { kind: "toggle", key: "transparent", label: "Transparent", default: false },
  ];

  private points: Point[] = [];
  private drawing = false;
  private drag: { start: Point; cur: Point } | null = null;
  private mode: SelectionMode = "new";

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const sel = ctx.doc.selection;
    if (!sel.isEmpty && sel.contains(Math.floor(e.x), Math.floor(e.y)) && !e.shiftKey && !e.altKey) {
      this.drag = { start: { x: e.x, y: e.y }, cur: { x: e.x, y: e.y } };
      ctx.setCursor("move");
      return;
    }
    this.mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
    this.points = [{ x: e.x, y: e.y }];
    this.drawing = true;
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.drag) {
      this.drag.cur = { x: e.x, y: e.y };
      ctx.invalidateOverlay();
      return;
    }
    if (!this.drawing) {
      const sel = ctx.doc.selection;
      ctx.setCursor(!sel.isEmpty && sel.contains(Math.floor(e.x), Math.floor(e.y)) ? "move" : "crosshair");
      return;
    }
    const last = this.points[this.points.length - 1]!;
    if (Math.hypot(last.x - e.x, last.y - e.y) * ctx.viewport.zoom >= 1.5) {
      this.points.push({ x: e.x, y: e.y });
      ctx.invalidateOverlay();
    }
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      ctx.setCursor("crosshair");
      ctx.invalidateOverlay();
      this.applyPatch(ctx, { x: Math.round(e.x - d.start.x), y: Math.round(e.y - d.start.y) });
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;
    const pts = this.points;
    this.points = [];
    ctx.invalidateOverlay();
    if (pts.length < 3) return;
    const { width, height } = ctx.doc;
    const shape = Selection.fromPolygon(width, height, pts, true);
    ctx.exec(new SetSelectionCommand(combineSelection(ctx.doc.selection, shape, this.mode), "Patch Selection"));
  }

  private applyPatch(ctx: ToolContext, delta: Point): void {
    if (delta.x === 0 && delta.y === 0) return;
    const target = resolvePaintTarget(ctx, "patch");
    if (!target || target.kind !== "layer" || !target.layer || target.layer.kind !== "raster") {
      if (target) ctx.notify("info", "The Patch tool works on pixel layers.");
      return;
    }
    const layer = target.layer;
    const sel = ctx.doc.selection;
    if (sel.isEmpty) return;
    const w = layer.raster.width;
    const h = layer.raster.height;
    const sourceMode = ctx.opt<string>("patch") === "source";
    // Source mode: fix the selected area with pixels from (selection + delta).
    // Destination mode: copy the selected pixels to (selection + delta) and blend there.
    const maskSel = sourceMode ? sel : sel.translate(delta.x, delta.y);
    const mask = maskFromBytes(maskSel.mask, maskSel.width, maskSel.height, w, h, layer.offset);
    const offset = sourceMode ? delta : { x: -delta.x, y: -delta.y };
    const bb = maskBounds(mask, w, h);
    if (!bb) return;
    const area = Rect.intersect(Rect.inflate(bb, 8), layer.raster.bounds());
    const captured = PaintCommand.capture(layer, area);
    const src = layer.raster.clone();
    const touched = healRegion(layer.raster, src, mask, offset, { mode: ctx.opt<boolean>("transparent") ? "replace" : "normal" });
    if (!touched) return;
    ctx.exec(PaintCommand.finish(layer, captured, "Patch", touched), { alreadyApplied: true, noMerge: true });
    if (!sourceMode) ctx.exec(new SetSelectionCommand(maskSel, "Patch Selection"));
  }

  cancel(ctx: ToolContext): void {
    this.points = [];
    this.drawing = false;
    this.drag = null;
    ctx.invalidateOverlay();
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const vp = ctx.viewport;
    if (this.points.length > 1) {
      const pts = this.points.map((p) => vp.docToScreen(p));
      strokeOutline(g, () => {
        g.beginPath();
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.closePath();
      });
    }
    const d = this.drag;
    const bb = ctx.doc.selection.bbox;
    if (d && bb) {
      const dx = d.cur.x - d.start.x;
      const dy = d.cur.y - d.start.y;
      const a = vp.docToScreen({ x: bb.x + dx, y: bb.y + dy });
      const b = vp.docToScreen({ x: bb.x + bb.w + dx, y: bb.y + bb.h + dy });
      strokeOutline(g, () => {
        g.beginPath();
        g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      });
    }
  }
}

export class RedEyeTool implements Tool {
  readonly id = "red-eye";
  readonly name = "Red Eye";
  readonly icon = Eye;
  readonly shortcut = "j";
  readonly group = "healing";
  readonly groupOrder = 4;
  readonly cursor = "crosshair";
  readonly hint = "Click on a red pupil to neutralise and darken it.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "pupil", label: "Pupil Size", min: 1, max: 100, step: 1, default: 50, unit: "%" },
    { kind: "number", key: "darken", label: "Darken Amount", min: 1, max: 100, step: 1, default: 50, unit: "%" },
  ];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const target = resolvePaintTarget(ctx, "fix");
    if (!target || target.kind !== "layer" || !target.layer || target.layer.kind !== "raster") return;
    const layer = target.layer;
    const r = layer.raster;
    const cx = Math.floor(e.x - layer.offset.x);
    const cy = Math.floor(e.y - layer.offset.y);
    const maxR = Math.max(4, Math.round((ctx.opt<number>("pupil") / 100) * 60));
    const blob = redBlob(r, cx, cy, maxR);
    if (!blob) {
      ctx.notify("info", "No red-eye found under the cursor. Click closer to the centre of the pupil.");
      return;
    }
    const { rect, mask } = blob;
    const captured = PaintCommand.capture(layer, rect);
    const darken = ctx.opt<number>("darken") / 100;
    const d = r.data;
    const c = { r: 0, g: 0, b: 0, a: 0 };
    const o = { r: 0, g: 0, b: 0, a: 0 };
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const k = mask[(y - rect.y) * rect.w + (x - rect.x)]!;
        if (k <= 0) continue;
        const p = (y * r.width + x) * 4;
        c.r = d[p]!;
        c.g = d[p + 1]!;
        c.b = d[p + 2]!;
        c.a = d[p + 3]!;
        fixRedEye(c, darken, o);
        d[p] = c.r + (o.r - c.r) * k;
        d[p + 1] = c.g + (o.g - c.g) * k;
        d[p + 2] = c.b + (o.b - c.b) * k;
      }
    }
    ctx.exec(PaintCommand.finish(layer, captured, "Red Eye", rect), { alreadyApplied: true, noMerge: true });
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}

/**
 * Find the red-dominant blob around (cx, cy): search a small window for a red seed,
 * flood-fill red pixels within `maxR`, and return a feathered coverage mask.
 */
export function redBlob(r: Raster, cx: number, cy: number, maxR: number): { rect: Rect; mask: Float32Array } | null {
  const w = r.width;
  const h = r.height;
  const d = r.data;
  const isRed = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const p = (y * w + x) * 4;
    return isRedEyePixel(d[p]!, d[p + 1]!, d[p + 2]!);
  };
  let seed: Point | null = null;
  for (let rad = 0; rad <= Math.min(maxR, 12) && !seed; rad++) {
    for (let dy = -rad; dy <= rad && !seed; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (isRed(cx + dx, cy + dy)) {
          seed = { x: cx + dx, y: cy + dy };
          break;
        }
      }
    }
  }
  if (!seed) return null;
  const x0 = Math.max(0, seed.x - maxR);
  const y0 = Math.max(0, seed.y - maxR);
  const x1 = Math.min(w - 1, seed.x + maxR);
  const y1 = Math.min(h - 1, seed.y + maxR);
  const rw = x1 - x0 + 1;
  const rh = y1 - y0 + 1;
  const inside = new Uint8Array(rw * rh);
  const stack = [seed.y * w + seed.x];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const li = (y - y0) * rw + (x - x0);
    if (inside[li]) continue;
    if (Math.hypot(x - seed.x, y - seed.y) > maxR || !isRed(x, y)) continue;
    inside[li] = 1;
    stack.push(i - 1, i + 1, i - w, i + w);
  }
  // Grow by one and feather so the fix doesn't leave a hard rim.
  const mask = new Float32Array(rw * rh);
  let any = false;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let best = inside[y * rw + x] ? 1 : 0;
      if (!best) {
        for (let dy = -1; dy <= 1 && best < 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue;
            if (inside[yy * rw + xx]) best = Math.max(best, 0.5);
          }
        }
      }
      mask[y * rw + x] = best;
      if (best > 0) any = true;
    }
  }
  if (!any) return null;
  return { rect: Rect.make(x0, y0, rw, rh), mask };
}
