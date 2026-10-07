/**
 * Base class for every brush-engine tool. Subclasses supply the options schema, the
 * `StrokeBlend` for a stroke and (optionally) Alt-click behaviour.
 */
import { Rect, compositeToRaster, type Point, type Raster, type RGBA } from "$lib/engine";
import { settings as appSettings } from "$lib/stores/settings.svelte";
import type { IconComponent, Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { BrushStroke, constrainAngle, maskGray, type BrushSettings, type StrokeBlend } from "./brush-engine";
import { brushStore } from "./brush-store.svelte";
import { resolvePaintTarget, type PaintTarget } from "./paint-target";
import { CompositeSampler } from "./util";
import { sampleColor } from "./eyedropper";

export const BRUSH_PICKER_OPTION: ToolOption = { kind: "custom", key: "brush", renderer: "brush-picker", label: "Brush" };
export const OPACITY_OPTION: ToolOption = { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" };
export const FLOW_OPTION: ToolOption = { kind: "number", key: "flow", label: "Flow", min: 1, max: 100, step: 1, default: 100, unit: "%" };
export const AIRBRUSH_OPTION: ToolOption = { kind: "toggle", key: "airbrush", label: "Airbrush", default: false };
export const SMOOTHING_OPTION: ToolOption = { kind: "number", key: "smoothing", label: "Smoothing", min: 0, max: 100, step: 1, default: 0, unit: "%", slider: true };
export const SAMPLE_OPTION: ToolOption = {
  kind: "select",
  key: "sample",
  label: "Sample",
  choices: [
    { value: "current", label: "Current Layer" },
    { value: "all", label: "All Layers" },
  ],
  default: "current",
};

export interface BrushToolSpec {
  id: string;
  name: string;
  icon: IconComponent;
  shortcut: string;
  group: string;
  groupOrder: number;
  hint: string;
  options: readonly ToolOption[];
  label: string;
  /** Pencil. */
  aliased?: boolean;
  /** Hardness forced (pencil = 100). */
  fixedHardness?: number;
}

export abstract class BrushBasedTool implements Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconComponent;
  readonly shortcut: string;
  readonly group: string;
  readonly groupOrder: number;
  readonly cursor = "crosshair";
  readonly hint: string;
  readonly options: readonly ToolOption[];
  protected readonly spec: BrushToolSpec;

  protected stroke: BrushStroke | null = null;
  protected target: PaintTarget | null = null;
  protected captured: { rect: Rect; pixels: Raster } | null = null;
  protected lastEnd: Point | null = null;
  protected hover: { sx: number; sy: number; x: number; y: number } | null = null;
  protected readonly sampler = new CompositeSampler();

  constructor(spec: BrushToolSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.name = spec.name;
    this.icon = spec.icon;
    this.shortcut = spec.shortcut;
    this.group = spec.group;
    this.groupOrder = spec.groupOrder;
    this.hint = spec.hint;
    this.options = spec.options;
  }

  /** The blend for a new stroke, or null to refuse (after notifying). */
  protected abstract makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null;

  /** Alt-click: default samples the foreground colour. Return true when handled. */
  protected onAltClick(e: ToolEvent, ctx: ToolContext): boolean {
    const c = sampleColor(ctx, e.x, e.y, false, this.sampler);
    if (c) ctx.setFg(c);
    return true;
  }

  /** Called when a stroke finished (after the command was pushed). */
  protected onStrokeEnd(_ctx: ToolContext, _stroke: BrushStroke, _target: PaintTarget): void {}

  /** The paint action name for toasts. */
  protected get action(): string {
    return "paint";
  }

  /** Live brush settings merged with the options bar (airbrush / smoothing). */
  protected effectiveSettings(ctx: ToolContext): BrushSettings {
    const s = { ...brushStore.settings };
    if (this.options.some((o) => o.key === "airbrush")) s.buildUp = ctx.opt<boolean>("airbrush");
    if (this.options.some((o) => o.key === "smoothing")) s.smoothing = ctx.opt<number>("smoothing");
    if (this.spec.fixedHardness !== undefined) s.hardness = this.spec.fixedHardness;
    return s;
  }

  /** Colour to paint on masks for a given colour. */
  protected static maskColor(target: PaintTarget, c: RGBA): RGBA {
    return target.isMask ? maskGray(c) : c;
  }

  protected opacityOf(ctx: ToolContext): number {
    return this.options.some((o) => o.key === "opacity") ? ctx.opt<number>("opacity") / 100 : 1;
  }

  protected flowOf(ctx: ToolContext): number {
    return this.options.some((o) => o.key === "flow") ? ctx.opt<number>("flow") / 100 : 1;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    if (e.altKey && this.onAltClick(e, ctx)) return;
    const target = resolvePaintTarget(ctx, this.action);
    if (!target) return;
    const blend = this.makeBlend(ctx, target, e);
    if (!blend) return;
    let captured: { rect: Rect; pixels: Raster };
    try {
      captured = target.capture();
    } catch (err) {
      ctx.notify("info", (err as Error).message);
      return;
    }
    const s = this.effectiveSettings(ctx);
    this.captured = captured;
    this.target = target;
    this.stroke = new BrushStroke(target.raster, {
      settings: s,
      blend,
      opacity: this.opacityOf(ctx),
      flow: this.flowOf(ctx),
      selection: ctx.doc.selection,
      offset: target.offset,
      aliased: this.spec.aliased ?? false,
    });
    const p = { x: e.x - target.offset.x, y: e.y - target.offset.y };
    if (e.shiftKey && this.lastEnd) {
      this.stroke.moveTo({ x: this.lastEnd.x - target.offset.x, y: this.lastEnd.y - target.offset.y }, { pressure: e.pressure, pointerType: e.pointerType });
    }
    const rect = this.stroke.moveTo(p, { pressure: e.pressure, pointerType: e.pointerType });
    if (rect) ctx.touch({ layerId: target.dirtyId, rect });
    this.lastEnd = { x: e.x, y: e.y };
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    this.hover = { sx: e.screenX, sy: e.screenY, x: e.x, y: e.y };
    ctx.invalidateOverlay();
    this.updateCursor(ctx, e);
    const s = this.stroke;
    const t = this.target;
    if (!s || !t) return;
    let p = { x: e.x, y: e.y };
    if (e.shiftKey && this.lastEnd) p = constrainAngle(this.lastEnd, p);
    const rect = s.moveTo({ x: p.x - t.offset.x, y: p.y - t.offset.y }, { pressure: e.pressure, pointerType: e.pointerType });
    if (rect) ctx.touch({ layerId: t.dirtyId, rect });
  }

  onPointerUp(e: ToolEvent, ctx: ToolContext): void {
    const s = this.stroke;
    const t = this.target;
    const captured = this.captured;
    this.stroke = null;
    this.target = null;
    this.captured = null;
    if (!s || !t || !captured) return;
    const tail = s.catchUp({ x: e.x - t.offset.x, y: e.y - t.offset.y }, { pressure: e.pressure, pointerType: e.pointerType });
    if (tail) ctx.touch({ layerId: t.dirtyId, rect: tail });
    this.lastEnd = { x: e.x, y: e.y };
    this.beforeFinish(ctx, s, t);
    const cmd = t.finish(captured, this.spec.label, s.dirtyRect);
    if (cmd) ctx.exec(cmd, { alreadyApplied: true, noMerge: true });
    if (s.dirtyRect) ctx.touch({ layerId: t.dirtyId, rect: s.dirtyRect });
    this.onStrokeEnd(ctx, s, t);
  }

  /** Hook before the undo command snapshots the result (healing post-processes here). */
  protected beforeFinish(_ctx: ToolContext, _stroke: BrushStroke, _target: PaintTarget): void {}

  onKey(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean {
    if (phase !== "down" || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === "[" || e.key === "]") {
      brushStore.stepSize(e.key === "]" ? 1 : -1);
      ctx.invalidateOverlay();
      return true;
    }
    if (e.key === "{" || e.key === "}") {
      brushStore.stepHardness(e.key === "}" ? 1 : -1);
      ctx.invalidateOverlay();
      return true;
    }
    const digit = /^Digit(\d)$/.exec(e.code ?? "")?.[1] ?? (/^\d$/.test(e.key) ? e.key : null);
    if (digit !== null) {
      const key = e.shiftKey ? "flow" : "opacity";
      if (!this.options.some((o) => o.key === key)) return false;
      const n = Number(digit);
      const v = n === 0 ? 100 : n * 10;
      ctx.setOpt(key, v);
      ctx.hint(`${key === "flow" ? "Flow" : "Opacity"}: ${v}%`);
      return true;
    }
    return false;
  }

  cancel(ctx: ToolContext): void {
    const s = this.stroke;
    const t = this.target;
    this.stroke = null;
    this.target = null;
    this.captured = null;
    if (!s || !t) return;
    const rect = s.abort();
    if (rect) ctx.touch({ layerId: t.dirtyId, rect });
  }

  onActivate(ctx: ToolContext): void {
    this.updateCursor(ctx);
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
    this.hover = null;
  }

  protected updateCursor(ctx: ToolContext, e?: ToolEvent): void {
    if (e?.altKey) {
      ctx.setCursor("crosshair");
      return;
    }
    const style = appSettings.value.paintingCursor;
    ctx.setCursor(style === "brush-size" ? "none" : style === "precise" ? "crosshair" : "crosshair");
  }

  /** Brush outline (size / roundness / angle at the current zoom) plus the smoothing string. */
  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    if (!this.hover) return;
    if (appSettings.value.paintingCursor !== "brush-size") return;
    const s = brushStore.settings;
    const zoom = ctx.viewport.zoom;
    const r = (s.size * zoom) / 2;
    const pen = this.stroke?.penPosition;
    const t = this.target;
    const center = pen && t ? ctx.viewport.docToScreen({ x: pen.x + t.offset.x, y: pen.y + t.offset.y }) : { x: this.hover.sx, y: this.hover.sy };
    g.save();
    if (pen && t && s.smoothing > 0) {
      g.strokeStyle = "rgba(20,115,230,0.8)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(center.x, center.y);
      g.lineTo(this.hover.sx, this.hover.sy);
      g.stroke();
    }
    g.translate(center.x, center.y);
    g.rotate((-s.angle * Math.PI) / 180 + ctx.viewport.rotation);
    const rr = Math.max(1.5, r);
    const ry = Math.max(1, rr * (s.roundness / 100));
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(0, 0, rr, ry, 0, 0, Math.PI * 2);
    g.strokeStyle = "rgba(0,0,0,0.65)";
    g.stroke();
    g.beginPath();
    g.ellipse(0, 0, Math.max(1, rr - 1), Math.max(0.5, ry - 1), 0, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.stroke();
    if (r < 4) {
      // Tiny brushes: draw a crosshair so the cursor stays visible.
      g.beginPath();
      g.moveTo(-6, 0);
      g.lineTo(6, 0);
      g.moveTo(0, -6);
      g.lineTo(0, 6);
      g.stroke();
    }
    g.restore();
    this.drawExtraOverlay(g, ctx);
  }

  protected drawExtraOverlay(_g: CanvasRenderingContext2D, _ctx: ToolContext): void {}

  /** Read a tool option as a brush-store-aware helper for subclasses. */
  protected static fgFor(ctx: ToolContext, target: PaintTarget): RGBA {
    return BrushBasedTool.maskColor(target, ctx.fg());
  }

  /** Composite or layer sampler for "Sample: All Layers". */
  protected sourceRaster(ctx: ToolContext, target: PaintTarget, all: boolean): { raster: Raster; offset: Point } {
    if (all || target.kind !== "layer") {
      return { raster: compositeNow(ctx), offset: { x: 0, y: 0 } };
    }
    return { raster: target.raster.clone(), offset: target.offset };
  }
}

/** Composite of the whole document (fresh copy). */
export function compositeNow(ctx: ToolContext): Raster {
  return compositeToRaster(ctx.doc);
}
