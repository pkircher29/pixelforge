/** Eraser (E), Background Eraser and Magic Eraser. */
import { Eraser, Sparkles, Wand } from "@lucide/svelte";
import { PaintCommand, Rect, Selection, compositeToRaster, type Raster, type RGBA } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import type { StrokeBlend } from "./brush-engine";
import { AIRBRUSH_OPTION, BRUSH_PICKER_OPTION, BrushBasedTool, FLOW_OPTION, OPACITY_OPTION, SMOOTHING_OPTION } from "./brush-base";
import { resolvePaintTarget, type PaintTarget } from "./paint-target";
import { backgroundEraseWeight, mapRegion } from "./retouch-math";
import { toolStore } from "$lib/stores/tool.svelte";
import { clearThroughMask } from "./paint/fill";

export class EraserTool extends BrushBasedTool {
  constructor() {
    super({
      id: "eraser",
      name: "Eraser",
      icon: Eraser,
      shortcut: "e",
      group: "eraser",
      groupOrder: 0,
      hint: "Drag to erase to transparency (to the background colour on a Background / mask). [ ] change size.",
      label: "Eraser",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "eraserMode",
          label: "Mode",
          choices: [
            { value: "brush", label: "Brush" },
            { value: "pencil", label: "Pencil" },
            { value: "block", label: "Block" },
          ],
          default: "brush",
        },
        OPACITY_OPTION,
        FLOW_OPTION,
        AIRBRUSH_OPTION,
        SMOOTHING_OPTION,
        { kind: "toggle", key: "eraseToHistory", label: "Erase to History", default: false },
      ],
    });
  }

  protected override get action(): string {
    return "erase";
  }

  protected override onAltClick(): boolean {
    return false; // Alt = erase to history (PS) handled in makeBlend.
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    if (target.isMask) return { mode: "color", color: BrushBasedTool.maskColor(target, ctx.bg()) };
    if (ctx.opt<boolean>("eraseToHistory") || e.altKey) {
      const src = target.layerId ? ctx.history.rasterFromSource(toolStore.historySource ?? { kind: "state", index: 0 }, target.layerId) : null;
      if (!src) {
        ctx.notify("info", "No history source for this layer — paint a stroke first or pick a source in the History panel.");
        return null;
      }
      return { mode: "source", sourceAt: (x, y, out) => src.getPixel(x, y, out) };
    }
    return { mode: "erase" };
  }

  protected override effectiveSettings(ctx: ToolContext) {
    const s = super.effectiveSettings(ctx);
    const m = ctx.opt<string>("eraserMode");
    if (m === "pencil") s.hardness = 100;
    if (m === "block") {
      s.tip = "square";
      s.hardness = 100;
      s.size = Math.max(4, Math.round(16 / Math.max(0.1, ctx.viewport.zoom)));
    }
    return s;
  }
}

export class BackgroundEraserTool extends BrushBasedTool {
  private sampled: RGBA | null = null;

  constructor() {
    super({
      id: "background-eraser",
      name: "Background Eraser",
      icon: Sparkles,
      shortcut: "e",
      group: "eraser",
      groupOrder: 1,
      hint: "Drag: colours similar to the one under the brush centre are erased. Protect Foreground keeps the FG colour.",
      label: "Background Eraser",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "sampling",
          label: "Sampling",
          choices: [
            { value: "continuous", label: "Continuous" },
            { value: "once", label: "Once" },
            { value: "background", label: "Background Swatch" },
          ],
          default: "continuous",
        },
        {
          kind: "select",
          key: "limits",
          label: "Limits",
          choices: [
            { value: "discontiguous", label: "Discontiguous" },
            { value: "contiguous", label: "Contiguous" },
          ],
          default: "contiguous",
        },
        { kind: "number", key: "tolerance", label: "Tolerance", min: 1, max: 100, step: 1, default: 50, unit: "%" },
        { kind: "toggle", key: "protectFg", label: "Protect Foreground Color", default: false },
      ],
    });
  }

  protected override get action(): string {
    return "erase";
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    if (target.isMask) return { mode: "color", color: BrushBasedTool.maskColor(target, ctx.bg()) };
    const sampling = ctx.opt<string>("sampling");
    const tol = ctx.opt<number>("tolerance");
    const protect = ctx.opt<boolean>("protectFg") ? ctx.fg() : null;
    const contiguous = ctx.opt<string>("limits") === "contiguous";
    this.sampled = sampling === "background" ? ctx.bg() : this.sampleAt(target, e.x, e.y);
    const tool = this;
    return {
      mode: "target",
      margin: 0,
      computeTarget: (before, rect) => {
        const sampled = tool.sampled ?? ctx.bg();
        const region = mapRegion(before, rect, (c, out) => {
          const w = backgroundEraseWeight(c.r, c.g, c.b, sampled, tol, protect);
          out.r = c.r;
          out.g = c.g;
          out.b = c.b;
          out.a = c.a * (1 - w);
          return out;
        });
        if (contiguous) {
          // Only erase pixels connected to the dab centre through erasable pixels.
          const cx = Math.floor((tool.hover?.x ?? e.x) - target.offset.x) - rect.x;
          const cy = Math.floor((tool.hover?.y ?? e.y) - target.offset.y) - rect.y;
          keepConnected(region, before.crop(rect), cx, cy);
        }
        return region;
      },
    };
  }

  private sampleAt(target: PaintTarget, x: number, y: number): RGBA {
    const p = target.raster.getPixel(Math.floor(x - target.offset.x), Math.floor(y - target.offset.y));
    return { r: p.r, g: p.g, b: p.b, a: 255 };
  }

  override onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.stroke && this.target && ctx.opt<string>("sampling") === "continuous") {
      this.sampled = this.sampleAt(this.target, e.x, e.y);
      this.stroke.invalidateTarget();
    }
    super.onPointerMove(e, ctx);
  }
}

/** Restore the alpha of pixels in `region` that are not 4-connected to `(cx, cy)` through erased pixels. */
function keepConnected(region: Raster, original: Raster, cx: number, cy: number): void {
  const w = region.width;
  const h = region.height;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
  const erasable = new Uint8Array(w * h);
  const rd = region.data;
  const od = original.data;
  for (let i = 0; i < w * h; i++) erasable[i] = rd[i * 4 + 3]! < od[i * 4 + 3]! ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const stack = [cy * w + cx];
  if (!erasable[stack[0]!]) {
    // Centre isn't erasable: nothing connected → restore everything.
    for (let i = 0; i < w * h; i++) rd[i * 4 + 3] = od[i * 4 + 3]!;
    return;
  }
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !erasable[i]) continue;
    seen[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!seen[i]) rd[i * 4 + 3] = od[i * 4 + 3]!;
}

/** Magic Eraser: click to erase similar colours to transparency (wand + clear). */
export class MagicEraserTool implements Tool {
  readonly id = "magic-eraser";
  readonly name = "Magic Eraser";
  readonly icon = Wand;
  readonly shortcut = "e";
  readonly group = "eraser";
  readonly groupOrder = 2;
  readonly cursor = "crosshair";
  readonly hint = "Click a colour to erase all similar pixels to transparency.";
  readonly options: readonly ToolOption[] = [
    { kind: "number", key: "tolerance", label: "Tolerance", min: 0, max: 255, step: 1, default: 32 },
    { kind: "toggle", key: "antialias", label: "Anti-alias", default: true },
    { kind: "toggle", key: "contiguous", label: "Contiguous", default: true },
    { kind: "toggle", key: "sampleMerged", label: "Sample All Layers", default: false },
    { kind: "number", key: "opacity", label: "Opacity", min: 1, max: 100, step: 1, default: 100, unit: "%" },
  ];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const target = resolvePaintTarget(ctx, "erase");
    if (!target || target.kind !== "layer" || !target.layer || target.layer.kind !== "raster") {
      if (target) ctx.notify("info", "The Magic Eraser works on pixel layers.");
      return;
    }
    const layer = target.layer;
    const doc = ctx.doc;
    const px = Math.floor(e.x);
    const py = Math.floor(e.y);
    if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return;
    const tol = ctx.opt<number>("tolerance");
    const contiguous = ctx.opt<boolean>("contiguous");
    let mask: Selection;
    if (ctx.opt<boolean>("sampleMerged")) mask = Selection.fromMagicWand(compositeToRaster(doc), px, py, tol, contiguous);
    else {
      const lx = px - layer.offset.x;
      const ly = py - layer.offset.y;
      if (lx < 0 || ly < 0 || lx >= layer.raster.width || ly >= layer.raster.height) return;
      mask = Selection.fromMagicWand(layer.raster, lx, ly, tol, contiguous, { size: { w: doc.width, h: doc.height }, offset: layer.offset });
    }
    if (ctx.opt<boolean>("antialias")) mask = mask.feather(0.6);
    if (!doc.selection.isEmpty) mask = mask.intersect(doc.selection);
    const bb = mask.bbox;
    if (!bb) return;
    const area = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
    if (Rect.isEmpty(area)) return;
    const captured = PaintCommand.capture(layer, area);
    const op = ctx.opt<number>("opacity") / 100;
    const scaled = op < 1 ? scaleSelection(mask, op) : mask;
    const touched = clearThroughMask(layer.raster, scaled, layer.offset);
    if (!touched) return;
    ctx.exec(PaintCommand.finish(layer, captured, "Magic Eraser", touched), { alreadyApplied: true, noMerge: true });
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}

function scaleSelection(s: Selection, k: number): Selection {
  const out = s.clone();
  for (let i = 0; i < out.mask.length; i++) out.mask[i] = Math.round(out.mask[i]! * k);
  out.invalidate();
  return out;
}
