/** Color Replacement (B): keeps luminosity, replaces hue / saturation with the foreground colour. */
import { Palette } from "@lucide/svelte";
import type { RGBA } from "$lib/engine";
import type { ToolContext, ToolEvent } from "./types";
import type { StrokeBlend } from "./brush-engine";
import { BRUSH_PICKER_OPTION, BrushBasedTool } from "./brush-base";
import type { PaintTarget } from "./paint-target";
import { mapRegion, replaceColor, type ReplaceMode } from "./retouch-math";

export class ColorReplacementTool extends BrushBasedTool {
  private sampled: RGBA | null = null;

  constructor() {
    super({
      id: "color-replacement",
      name: "Color Replacement",
      icon: Palette,
      shortcut: "b",
      group: "brush",
      groupOrder: 2,
      hint: "Drag over a colour: it is replaced with the foreground colour, keeping the shading. Alt-click samples.",
      label: "Color Replacement",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "mode",
          label: "Mode",
          choices: [
            { value: "hue", label: "Hue" },
            { value: "saturation", label: "Saturation" },
            { value: "color", label: "Color" },
            { value: "luminosity", label: "Luminosity" },
          ],
          default: "color",
        },
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
        { kind: "number", key: "tolerance", label: "Tolerance", min: 1, max: 100, step: 1, default: 30, unit: "%" },
        { kind: "toggle", key: "antialias", label: "Anti-alias", default: true },
        { kind: "color", key: "fg", label: "Color" },
      ],
    });
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    if (target.isMask) return { mode: "color", color: BrushBasedTool.maskColor(target, ctx.fg()) };
    const mode = ctx.opt<string>("mode") as ReplaceMode;
    const tol = ctx.opt<number>("tolerance");
    const aa = ctx.opt<boolean>("antialias");
    const sampling = ctx.opt<string>("sampling");
    const fg = ctx.fg();
    this.sampled = sampling === "background" ? ctx.bg() : this.sampleAt(target, e.x, e.y);
    const tool = this;
    return {
      mode: "target",
      margin: 0,
      computeTarget: (before, rect) =>
        mapRegion(before, rect, (c, out) => {
          const r = replaceColor(c, tool.sampled ?? fg, fg, mode, tol, aa, out);
          // `a` carries the match weight: unmatched pixels keep the snapshot (weight 0 → same colour).
          r.a = c.a;
          return r;
        }),
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
