/** Magic Wand (W): select similar colors by tolerance. */
import { WandSparkles } from "@lucide/svelte";
import { Selection, SetSelectionCommand, activeLayer, compositeToRaster } from "$lib/engine";
import type { SelectionMode, Tool, ToolContext, ToolEvent, ToolOption } from "./types";
import { combineSelection, featherIf, modeFromModifiers, selectionLabel } from "./selection-mod";

export class WandTool implements Tool {
  readonly id = "wand";
  readonly name = "Magic Wand";
  readonly icon = WandSparkles;
  readonly shortcut = "w";
  readonly group = "quickselect";
  readonly groupOrder = 1;
  readonly cursor = "crosshair";
  readonly hint = "Click a color to select it. Shift adds, Alt subtracts.";
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
    { kind: "number", key: "tolerance", label: "Tolerance", min: 0, max: 255, step: 1, default: 32 },
    { kind: "toggle", key: "contiguous", label: "Contiguous", default: true },
    { kind: "toggle", key: "sampleMerged", label: "Sample all layers", default: false },
    { kind: "number", key: "feather", label: "Feather", min: 0, max: 250, step: 1, default: 0, unit: "px", slider: false },
  ];

  onPointerDown(e: ToolEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const mode = modeFromModifiers(e, ctx.opt<SelectionMode>("mode"));
    const sel = wandSelection(ctx, e.x, e.y, {
      tolerance: ctx.opt<number>("tolerance"),
      contiguous: ctx.opt<boolean>("contiguous"),
      sampleMerged: ctx.opt<boolean>("sampleMerged"),
    });
    if (!sel) return;
    const shape = featherIf(sel, ctx.opt<number>("feather"));
    const next = combineSelection(ctx.doc.selection, shape, mode);
    ctx.exec(new SetSelectionCommand(next, selectionLabel("Magic Wand", mode)));
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
}

export interface WandOptions {
  tolerance: number;
  contiguous: boolean;
  sampleMerged: boolean;
}

/**
 * Build the wand selection at a doc point. Samples the composite when
 * `sampleMerged`, otherwise the active raster layer (offset-aware). Null when the
 * click misses the layer / document.
 */
export function wandSelection(ctx: ToolContext, x: number, y: number, o: WandOptions): Selection | null {
  const doc = ctx.doc;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return null;
  if (o.sampleMerged) {
    const comp = compositeToRaster(doc);
    return Selection.fromMagicWand(comp, px, py, o.tolerance, o.contiguous);
  }
  const layer = activeLayer(doc);
  if (!layer || layer.kind !== "raster") {
    ctx.notify("info", "Select a pixel layer, or turn on “Sample all layers”.");
    return null;
  }
  const lx = px - layer.offset.x;
  const ly = py - layer.offset.y;
  if (lx < 0 || ly < 0 || lx >= layer.raster.width || ly >= layer.raster.height) return null;
  return Selection.fromMagicWand(layer.raster, lx, ly, o.tolerance, o.contiguous, {
    size: { w: doc.width, h: doc.height },
    offset: layer.offset,
  });
}
