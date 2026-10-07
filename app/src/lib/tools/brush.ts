/** Brush (B) and Pencil — color painting through the brush engine. */
import { Brush, Pencil } from "@lucide/svelte";
import type { ToolContext, ToolEvent, ToolOption } from "./types";
import type { StrokeBlend } from "./brush-engine";
import { AIRBRUSH_OPTION, BRUSH_PICKER_OPTION, BrushBasedTool, FLOW_OPTION, OPACITY_OPTION, SMOOTHING_OPTION } from "./brush-base";
import type { PaintTarget } from "./paint-target";
import { colorDistance } from "./retouch-math";

const MODE_OPTION: ToolOption = {
  kind: "select",
  key: "mode",
  label: "Mode",
  choices: [
    { value: "normal", label: "Normal" },
    { value: "behind", label: "Behind" },
    { value: "clear", label: "Clear" },
  ],
  default: "normal",
};

export class BrushTool extends BrushBasedTool {
  private readonly pencil: boolean;

  constructor(kind: "brush" | "pencil") {
    const pencil = kind === "pencil";
    super({
      id: pencil ? "pencil" : "brush",
      name: pencil ? "Pencil" : "Brush",
      icon: pencil ? Pencil : Brush,
      shortcut: "b",
      group: "brush",
      groupOrder: pencil ? 1 : 0,
      hint: pencil
        ? "Drag to draw hard-edged lines. Shift-click draws a straight line from the last point; Alt-click samples a color."
        : "Drag to paint. Shift-click paints a straight line from the last point; Alt-click samples a color. [ ] size, { } hardness, 1-0 opacity.",
      label: pencil ? "Pencil" : "Brush Tool",
      aliased: pencil,
      ...(pencil ? { fixedHardness: 100 } : {}),
      options: pencil
        ? [BRUSH_PICKER_OPTION, MODE_OPTION, OPACITY_OPTION, { kind: "toggle", key: "autoErase", label: "Auto Erase", default: false }, SMOOTHING_OPTION, { kind: "color", key: "fg", label: "Color" }]
        : [BRUSH_PICKER_OPTION, MODE_OPTION, OPACITY_OPTION, FLOW_OPTION, AIRBRUSH_OPTION, SMOOTHING_OPTION, { kind: "color", key: "fg", label: "Color" }],
    });
    this.pencil = pencil;
  }

  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend | null {
    const mode = ctx.opt<string>("mode");
    if (mode === "clear" && !target.isMask) return { mode: "erase" };
    let color = ctx.fg();
    if (this.pencil && ctx.opt<boolean>("autoErase")) {
      // Auto Erase: starting on the foreground color paints the background color.
      const p = target.raster.getPixel(Math.floor(e.x - target.offset.x), Math.floor(e.y - target.offset.y));
      if (p.a > 0 && colorDistance(color, p.r, p.g, p.b) < 8) color = ctx.bg();
    }
    if (mode === "behind" && !target.isMask) {
      // Behind: only paints where the layer is transparent → encode as a source blend that
      // returns the color scaled by (1 - existing alpha).
      const before = target.raster.clone();
      const c = BrushBasedTool.maskColor(target, color);
      return {
        mode: "source",
        sourceAt: (x, y, out) => {
          const a = before.getPixel(x, y).a;
          out.r = c.r;
          out.g = c.g;
          out.b = c.b;
          out.a = 255 - a;
        },
      };
    }
    return { mode: "color", color: BrushBasedTool.maskColor(target, color) };
  }
}
