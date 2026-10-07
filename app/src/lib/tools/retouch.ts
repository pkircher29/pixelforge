/** Blur / Sharpen / Smudge and Dodge (O) / Burn / Sponge — brush-applied local ops. */
import { Droplets, Pointer as Fingerprint, Flame, Sun, Triangle, Droplet as Waves } from "@lucide/svelte";
import type { ToolContext, ToolEvent, ToolOption } from "./types";
import type { StrokeBlend } from "./brush-engine";
import { BRUSH_PICKER_OPTION, BrushBasedTool, SAMPLE_OPTION } from "./brush-base";
import type { PaintTarget } from "./paint-target";
import { boxBlurRegion, dodgeBurn, mapRegion, sharpenRegion, sponge, type ToneRange } from "./retouch-math";
import { brushStore } from "./brush-store.svelte";

const STRENGTH_OPTION: ToolOption = { kind: "number", key: "strength", label: "Strength", min: 1, max: 100, step: 1, default: 50, unit: "%" };
const RANGE_OPTION: ToolOption = {
  kind: "select",
  key: "range",
  label: "Range",
  choices: [
    { value: "shadows", label: "Shadows" },
    { value: "midtones", label: "Midtones" },
    { value: "highlights", label: "Highlights" },
  ],
  default: "midtones",
};

export class BlurTool extends BrushBasedTool {
  constructor() {
    super({
      id: "blur",
      name: "Blur",
      icon: Droplets,
      shortcut: "",
      group: "blur",
      groupOrder: 0,
      hint: "Drag to soften pixels. Strength sets how much blur each pass applies.",
      label: "Blur Tool",
      options: [BRUSH_PICKER_OPTION, STRENGTH_OPTION, SAMPLE_OPTION],
    });
  }
  protected override onAltClick(): boolean {
    return false;
  }
  protected makeBlend(_ctx: ToolContext): StrokeBlend {
    const radius = Math.max(1, Math.round(brushStore.settings.size * 0.12));
    return { mode: "target", margin: radius + 1, computeTarget: (before, rect) => boxBlurRegion(before, rect, radius) };
  }
  protected override opacityOf(ctx: ToolContext): number {
    return ctx.opt<number>("strength") / 100;
  }
}

export class SharpenTool extends BrushBasedTool {
  constructor() {
    super({
      id: "sharpen",
      name: "Sharpen",
      icon: Triangle,
      shortcut: "",
      group: "blur",
      groupOrder: 1,
      hint: "Drag to sharpen pixels (unsharp mask under the brush).",
      label: "Sharpen Tool",
      options: [BRUSH_PICKER_OPTION, STRENGTH_OPTION, SAMPLE_OPTION, { kind: "toggle", key: "protectDetail", label: "Protect Detail", default: true }],
    });
  }
  protected override onAltClick(): boolean {
    return false;
  }
  protected makeBlend(ctx: ToolContext): StrokeBlend {
    const amount = ctx.opt<boolean>("protectDetail") ? 1.2 : 2.5;
    return { mode: "target", margin: 3, computeTarget: (before, rect) => sharpenRegion(before, rect, 1.5, amount) };
  }
  protected override opacityOf(ctx: ToolContext): number {
    return ctx.opt<number>("strength") / 100;
  }
}

export class SmudgeTool extends BrushBasedTool {
  constructor() {
    super({
      id: "smudge",
      name: "Smudge",
      icon: Fingerprint,
      shortcut: "",
      group: "blur",
      groupOrder: 2,
      hint: "Drag to smear color. Finger Painting starts the stroke with the foreground color.",
      label: "Smudge Tool",
      options: [BRUSH_PICKER_OPTION, STRENGTH_OPTION, SAMPLE_OPTION, { kind: "toggle", key: "fingerPainting", label: "Finger Painting", default: false }],
    });
  }
  protected override onAltClick(): boolean {
    return false;
  }
  protected makeBlend(ctx: ToolContext, target: PaintTarget, e: ToolEvent): StrokeBlend {
    const finger = ctx.opt<boolean>("fingerPainting") !== e.altKey;
    return { mode: "smudge", strength: ctx.opt<number>("strength") / 100, fingerColor: finger ? BrushBasedTool.maskColor(target, ctx.fg()) : null };
  }
}

export class DodgeBurnTool extends BrushBasedTool {
  private readonly kind: "dodge" | "burn";

  constructor(kind: "dodge" | "burn") {
    super({
      id: kind,
      name: kind === "dodge" ? "Dodge" : "Burn",
      icon: kind === "dodge" ? Sun : Flame,
      shortcut: "o",
      group: "dodge",
      groupOrder: kind === "dodge" ? 0 : 1,
      hint: kind === "dodge" ? "Drag to lighten. Range picks shadows / midtones / highlights; Exposure sets the strength." : "Drag to darken. Range picks shadows / midtones / highlights; Exposure sets the strength.",
      label: kind === "dodge" ? "Dodge Tool" : "Burn Tool",
      options: [
        BRUSH_PICKER_OPTION,
        RANGE_OPTION,
        { kind: "number", key: "exposure", label: "Exposure", min: 1, max: 100, step: 1, default: 50, unit: "%" },
        { kind: "toggle", key: "airbrush", label: "Airbrush", default: false },
        { kind: "toggle", key: "protectTones", label: "Protect Tones", default: true },
      ],
    });
    this.kind = kind;
  }
  protected override onAltClick(): boolean {
    return false;
  }
  protected makeBlend(ctx: ToolContext): StrokeBlend {
    const range = ctx.opt<string>("range") as ToneRange;
    const exposure = ctx.opt<number>("exposure") / 100;
    const protect = ctx.opt<boolean>("protectTones");
    const kind = this.kind;
    return { mode: "target", margin: 0, computeTarget: (before, rect) => mapRegion(before, rect, (c, out) => dodgeBurn(c, kind, range, exposure, protect, out)) };
  }
}

export class SpongeTool extends BrushBasedTool {
  constructor() {
    super({
      id: "sponge",
      name: "Sponge",
      icon: Waves,
      shortcut: "o",
      group: "dodge",
      groupOrder: 2,
      hint: "Drag to saturate or desaturate. Flow sets how fast the change builds up.",
      label: "Sponge Tool",
      options: [
        BRUSH_PICKER_OPTION,
        {
          kind: "select",
          key: "spongeMode",
          label: "Mode",
          choices: [
            { value: "desaturate", label: "Desaturate" },
            { value: "saturate", label: "Saturate" },
          ],
          default: "desaturate",
        },
        { kind: "number", key: "flow", label: "Flow", min: 1, max: 100, step: 1, default: 50, unit: "%" },
        { kind: "toggle", key: "airbrush", label: "Airbrush", default: false },
        { kind: "toggle", key: "vibrance", label: "Vibrance", default: true },
      ],
    });
  }
  protected override onAltClick(): boolean {
    return false;
  }
  protected makeBlend(ctx: ToolContext): StrokeBlend {
    const mode = ctx.opt<string>("spongeMode") as "saturate" | "desaturate";
    const vib = ctx.opt<boolean>("vibrance");
    return { mode: "target", margin: 0, computeTarget: (before, rect) => mapRegion(before, rect, (c, out) => sponge(c, mode, 1, vib, out)) };
  }
  protected override opacityOf(): number {
    return 1;
  }
}
