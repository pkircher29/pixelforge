/** Eyedropper (I), Color Sampler (persistent markers → Info panel) and Ruler (measure → Info panel). */
import { Pipette, Crosshair, Ruler } from "@lucide/svelte";
import { activeLayer, compositeToRaster, type Point, type RGBA } from "$lib/engine";
import { RotateCanvasCommand } from "$lib/filters/transform/commands";
import { toolStore, type ColorSampler } from "$lib/stores/tool.svelte";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { CompositeSampler } from "./util";
import { formatMeasure, measureLine, straightenAngle } from "./measure";

const SAMPLE_SIZE_OPTION: ToolOption = {
  kind: "select",
  key: "sampleSize",
  label: "Sample Size",
  choices: [
    { value: "1", label: "Point Sample" },
    { value: "3", label: "3 by 3 Average" },
    { value: "5", label: "5 by 5 Average" },
    { value: "11", label: "11 by 11 Average" },
  ],
  default: "1",
};

export class EyedropperTool implements Tool {
  readonly id = "eyedropper";
  readonly name = "Eyedropper";
  readonly icon = Pipette;
  readonly shortcut = "i";
  readonly group = "eyedropper";
  readonly groupOrder = 0;
  readonly cursor = "crosshair";
  readonly hint = "Click to set the foreground colour. Alt-click sets the background.";
  readonly options: readonly ToolOption[] = [
    SAMPLE_SIZE_OPTION,
    {
      kind: "select",
      key: "sample",
      label: "Sample",
      choices: [
        { value: "composite", label: "All Layers" },
        { value: "layer", label: "Current Layer" },
      ],
      default: "composite",
    },
    { kind: "toggle", key: "showRing", label: "Show Sampling Ring", default: true },
  ];

  private readonly sampler = new CompositeSampler();
  private down = false;
  private ring: { sx: number; sy: number; before: RGBA; now: RGBA } | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.down = true;
    this.pick(e, ctx);
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.down && e.buttons & 1) this.pick(e, ctx);
  }

  onPointerUp(_e: ToolEvent, ctx: ToolContext): void {
    this.down = false;
    this.ring = null;
    ctx.invalidateOverlay();
  }

  private pick(e: ToolEvent, ctx: ToolContext): void {
    const before = e.altKey ? ctx.bg() : ctx.fg();
    const c = sampleColor(ctx, e.x, e.y, ctx.opt<string>("sample") === "layer", this.sampler, Number(ctx.opt<string>("sampleSize")));
    if (!c) return;
    if (e.altKey) ctx.setBg(c);
    else ctx.setFg(c);
    if (ctx.opt<boolean>("showRing")) {
      this.ring = { sx: e.screenX, sy: e.screenY, before, now: c };
      ctx.invalidateOverlay();
    }
  }

  drawOverlay(g: CanvasRenderingContext2D): void {
    const r = this.ring;
    if (!r) return;
    // PS sampling ring: top half = new colour, bottom half = previous colour.
    g.save();
    g.lineWidth = 14;
    g.beginPath();
    g.arc(r.sx, r.sy, 34, Math.PI, 0);
    g.strokeStyle = `rgb(${r.now.r},${r.now.g},${r.now.b})`;
    g.stroke();
    g.beginPath();
    g.arc(r.sx, r.sy, 34, 0, Math.PI);
    g.strokeStyle = `rgb(${r.before.r},${r.before.g},${r.before.b})`;
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.beginPath();
    g.arc(r.sx, r.sy, 41, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(r.sx, r.sy, 27, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.stroke();
    g.restore();
  }
}

/** Shared with Brush Alt-click. Averages a `size × size` window. Returns null outside the canvas. */
export function sampleColor(ctx: ToolContext, x: number, y: number, layerOnly: boolean, sampler: CompositeSampler, size = 1): RGBA | null {
  const doc = ctx.doc;
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const half = Math.floor(Math.max(1, size) / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const l = layerOnly ? activeLayer(doc) : undefined;
  const comp = !layerOnly && size > 1 ? compositeToRaster(doc) : null;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = Math.floor(x) + dx;
      const py = Math.floor(y) + dy;
      if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) continue;
      let c: RGBA;
      if (layerOnly) {
        if (!l || l.kind !== "raster") return null;
        c = l.raster.getPixel(px - l.offset.x, py - l.offset.y);
      } else c = comp ? comp.getPixel(px, py) : sampler.sample(doc, px, py);
      r += c.r;
      g += c.g;
      b += c.b;
      n++;
    }
  }
  if (n === 0) return null;
  // A fully transparent sample reads as black; Photoshop does the same.
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: 255 };
}

export class ColorSamplerTool implements Tool {
  readonly id = "color-sampler";
  readonly name = "Color Sampler";
  readonly icon = Crosshair;
  readonly shortcut = "i";
  readonly group = "eyedropper";
  readonly groupOrder = 1;
  readonly cursor = "crosshair";
  readonly hint = "Click to place up to 4 colour samplers (values in the Info panel). Drag to move one, Alt-click to remove it.";
  readonly options: readonly ToolOption[] = [SAMPLE_SIZE_OPTION, { kind: "button", key: "clear", label: "Clear All", action: () => toolStore.clearColorSamplers() }];

  private readonly sampler = new CompositeSampler();
  private dragId: number | null = null;

  private hit(ctx: ToolContext, sx: number, sy: number): ColorSampler | null {
    for (const s of toolStore.colorSamplers) {
      const p = ctx.viewport.docToScreen({ x: s.x + 0.5, y: s.y + 0.5 });
      if (Math.hypot(p.x - sx, p.y - sy) <= 9) return s;
    }
    return null;
  }

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const hit = this.hit(ctx, e.screenX, e.screenY);
    if (hit) {
      if (e.altKey) {
        toolStore.removeColorSampler(hit.id);
        ctx.invalidateOverlay();
        return;
      }
      this.dragId = hit.id;
      return;
    }
    const c = sampleColor(ctx, e.x, e.y, false, this.sampler, Number(ctx.opt<string>("sampleSize")));
    if (!c) return;
    const s = toolStore.addColorSampler(Math.floor(e.x), Math.floor(e.y), c);
    if (!s) ctx.notify("info", "Photoshop-style limit: 4 colour samplers. Alt-click one to remove it.");
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.dragId === null) {
      ctx.setCursor(this.hit(ctx, e.screenX, e.screenY) ? "move" : "crosshair");
      return;
    }
    const c = sampleColor(ctx, e.x, e.y, false, this.sampler, Number(ctx.opt<string>("sampleSize")));
    if (!c) return;
    toolStore.updateColorSampler(this.dragId, { x: Math.floor(e.x), y: Math.floor(e.y), color: c });
    ctx.invalidateOverlay();
  }

  onPointerUp(): void {
    this.dragId = null;
  }

  /** Refresh every sampler's colour (call after pixel changes). */
  refresh(ctx: ToolContext): void {
    for (const s of toolStore.colorSamplers) {
      const c = sampleColor(ctx, s.x, s.y, false, this.sampler, Number(ctx.opt<string>("sampleSize")));
      if (c) toolStore.updateColorSampler(s.id, { color: c });
    }
  }

  onActivate(ctx: ToolContext): void {
    this.refresh(ctx);
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    drawSamplers(g, ctx);
  }
}

/** Sampler markers: a crosshair-in-circle with a numbered badge (also used by other tools' overlays). */
export function drawSamplers(g: CanvasRenderingContext2D, ctx: ToolContext): void {
  for (const s of toolStore.colorSamplers) {
    const p = ctx.viewport.docToScreen({ x: s.x + 0.5, y: s.y + 0.5 });
    g.save();
    g.lineWidth = 1.5;
    g.strokeStyle = "#000";
    g.beginPath();
    g.arc(p.x, p.y, 6, 0, Math.PI * 2);
    g.moveTo(p.x - 10, p.y);
    g.lineTo(p.x - 6, p.y);
    g.moveTo(p.x + 6, p.y);
    g.lineTo(p.x + 10, p.y);
    g.moveTo(p.x, p.y - 10);
    g.lineTo(p.x, p.y - 6);
    g.moveTo(p.x, p.y + 6);
    g.lineTo(p.x, p.y + 10);
    g.stroke();
    g.lineWidth = 0.8;
    g.strokeStyle = "#fff";
    g.stroke();
    g.font = "bold 10px Segoe UI, sans-serif";
    g.fillStyle = "#000";
    g.fillText(String(s.id), p.x + 8, p.y + 14);
    g.fillStyle = "#fff";
    g.fillText(String(s.id), p.x + 7, p.y + 13);
    g.restore();
  }
}

export class RulerTool implements Tool {
  readonly id = "ruler";
  readonly name = "Ruler";
  readonly icon = Ruler;
  readonly shortcut = "i";
  readonly group = "eyedropper";
  readonly groupOrder = 2;
  readonly cursor = "crosshair";
  readonly hint = "Drag to measure distance and angle (Info panel). Straighten rotates the canvas so the line is level.";
  readonly options: readonly ToolOption[] = [
    { kind: "custom", key: "readout", renderer: "measure-readout", label: "" },
    { kind: "button", key: "straighten", label: "Straighten Layer", action: (ctx) => this.straighten(ctx) },
    { kind: "button", key: "clear", label: "Clear", action: (ctx) => this.clear(ctx) },
  ];

  private start: Point | null = null;
  private dragEnd: 0 | 1 | null = null;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const m = toolStore.measure;
    if (m) {
      const a = ctx.viewport.docToScreen({ x: m.x0, y: m.y0 });
      const b = ctx.viewport.docToScreen({ x: m.x1, y: m.y1 });
      if (Math.hypot(a.x - e.screenX, a.y - e.screenY) < 8) {
        this.dragEnd = 0;
        return;
      }
      if (Math.hypot(b.x - e.screenX, b.y - e.screenY) < 8) {
        this.dragEnd = 1;
        return;
      }
    }
    this.start = { x: e.x, y: e.y };
    toolStore.measure = measureLine(e.x, e.y, e.x, e.y);
    ctx.invalidateOverlay();
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    const m = toolStore.measure;
    if (this.dragEnd !== null && m) {
      toolStore.measure = this.dragEnd === 0 ? measureLine(e.x, e.y, m.x1, m.y1) : measureLine(m.x0, m.y0, e.x, e.y);
      ctx.hint(formatMeasure(toolStore.measure));
      ctx.invalidateOverlay();
      return;
    }
    if (!this.start) return;
    let p = { x: e.x, y: e.y };
    if (e.shiftKey) {
      const ang = Math.round(Math.atan2(p.y - this.start.y, p.x - this.start.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - this.start.x, p.y - this.start.y);
      p = { x: this.start.x + Math.cos(ang) * len, y: this.start.y + Math.sin(ang) * len };
    }
    toolStore.measure = measureLine(this.start.x, this.start.y, p.x, p.y);
    ctx.hint(formatMeasure(toolStore.measure));
    ctx.invalidateOverlay();
  }

  onPointerUp(): void {
    this.start = null;
    this.dragEnd = null;
  }

  straighten(ctx: ToolContext): void {
    const m = toolStore.measure;
    if (!m || m.length < 2) {
      ctx.notify("info", "Drag a line along an edge that should be level first.");
      return;
    }
    const deg = straightenAngle(m);
    if (Math.abs(deg) < 0.01) return;
    ctx.exec(new RotateCanvasCommand(deg), { noMerge: true });
    ctx.compositor?.invalidateAll();
    toolStore.measure = null;
    ctx.invalidateOverlay();
    ctx.notify("success", `Rotated canvas by ${deg.toFixed(2)}°`);
  }

  clear(ctx: ToolContext): void {
    toolStore.measure = null;
    ctx.hint("");
    ctx.invalidateOverlay();
  }

  onDeactivate(): void {
    this.start = null;
  }

  drawOverlay(g: CanvasRenderingContext2D, ctx: ToolContext): void {
    const m = toolStore.measure;
    if (!m) return;
    const a = ctx.viewport.docToScreen({ x: m.x0, y: m.y0 });
    const b = ctx.viewport.docToScreen({ x: m.x1, y: m.y1 });
    g.save();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = "#fff";
    g.stroke();
    for (const p of [a, b]) {
      g.beginPath();
      g.moveTo(p.x - 5, p.y);
      g.lineTo(p.x + 5, p.y);
      g.moveTo(p.x, p.y - 5);
      g.lineTo(p.x, p.y + 5);
      g.strokeStyle = "#000";
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = "#fff";
      g.lineWidth = 1;
      g.stroke();
    }
    const label = `${m.length.toFixed(1)} px  ${m.angle.toFixed(1)}°`;
    g.font = "11px Segoe UI, sans-serif";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(30,30,30,0.9)";
    g.fillRect(b.x + 8, b.y - 22, tw, 18);
    g.fillStyle = "#e6e6e6";
    g.fillText(label, b.x + 13, b.y - 9);
    g.restore();
  }
}
