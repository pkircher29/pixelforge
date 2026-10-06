/** Eyedropper (I): sample the composite or the active layer into the foreground colour (Alt: background). */
import { Pipette } from "@lucide/svelte";
import { activeLayer, type RGBA } from "$lib/engine";
import type { Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { CompositeSampler } from "./util";

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
    {
      kind: "select",
      key: "sample",
      label: "Sample",
      choices: [
        { value: "composite", label: "All layers" },
        { value: "layer", label: "Current layer" },
      ],
      default: "composite",
    },
  ];

  private readonly sampler = new CompositeSampler();
  private down = false;

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.down = true;
    this.pick(e, ctx);
  }

  onPointerMove(e: ToolEvent, ctx: ToolContext): void {
    if (this.down && e.buttons & 1) this.pick(e, ctx);
  }

  onPointerUp(): void {
    this.down = false;
  }

  private pick(e: ToolEvent, ctx: ToolContext): void {
    const c = sampleColor(ctx, e.x, e.y, ctx.opt<string>("sample") === "layer", this.sampler);
    if (!c) return;
    if (e.altKey) ctx.setBg(c);
    else ctx.setFg(c);
  }
}

/** Shared with Brush Alt-click. Returns null outside the canvas. */
export function sampleColor(ctx: ToolContext, x: number, y: number, layerOnly: boolean, sampler: CompositeSampler): RGBA | null {
  const doc = ctx.doc;
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  let c: RGBA;
  if (layerOnly) {
    const l = activeLayer(doc);
    if (!l || l.kind !== "raster") return null;
    c = l.raster.getPixel(Math.floor(x - l.offset.x), Math.floor(y - l.offset.y));
  } else {
    c = sampler.sample(doc, x, y);
  }
  // A fully transparent sample reads as black; Photoshop does the same.
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 255 };
}
