/**
 * Registers every adjustment, filter, transform and image-size command with the UI
 * registry and mounts the Free Transform overlay. The shell imports this module once via
 * `import("$lib/filters/register")`.
 */

import { mount } from "svelte";
import { CropCanvasCommand, flipLayerCommand, rotateLayer90Command } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { registerCommand, type CommandDef } from "$lib/ui/registry.svelte";
import AdjustDialog from "$lib/ui/dialogs/AdjustDialog.svelte";
import ImageSizeDialog from "$lib/ui/dialogs/ImageSizeDialog.svelte";
import CanvasSizeDialog from "$lib/ui/dialogs/CanvasSizeDialog.svelte";
import TransformOverlay from "$lib/ui/dialogs/TransformOverlay.svelte";
import RotateCanvasDialog from "./ui/RotateCanvasDialog.svelte";
import { closeDialog, openDialog } from "./ui/dialogHost";
import { ADJUSTMENT_OPS, FILTER_OPS, commandIdFor } from "./ops";
import { activeRasterLayerOk, applyOpToActiveLayer } from "./applyToLayer";
import { getLastFilter } from "./lastFilter";
import { rawDoc } from "./raw";
import { defaultParams, type OpDef } from "./types";
import { FlipImageCommand, RotateImageCommand } from "./transform/commands";
import { transformSession } from "./transform/session.svelte";
import { trimRect } from "./transform/trim";

const rasterLayerEnabled = (): boolean => activeRasterLayerOk();
const docEnabled = (): boolean => !!docStore.doc;

/**
 * Wrap a command so any open filters dialog is closed first (its teardown restores the
 * live-preview pixels) and a pending Free Transform is committed.
 */
function guarded(run: () => void | Promise<void>): () => void | Promise<void> {
  return async () => {
    closeDialog();
    if (transformSession.active) await transformSession.commit();
    return run();
  };
}

function opCommand(op: OpDef, order: number): CommandDef {
  const def: CommandDef = {
    id: commandIdFor(op),
    label: op.instant ? op.label : `${op.label}…`,
    menu: op.menu,
    order,
    keywords: [...(op.keywords ?? []), op.menu.split("/").pop() ?? ""],
    enabled: rasterLayerEnabled,
    run: guarded(() => {
      if (op.instant) {
        applyOpToActiveLayer(op, defaultParams(op));
        return;
      }
      openDialog(AdjustDialog, { op });
    }),
  };
  if (op.shortcut) def.shortcut = op.shortcut;
  return def;
}

export function registerFilterCommands(): void {
  ADJUSTMENT_OPS.forEach((op, i) => registerCommand(opCommand(op, 100 + i * 10)));
  FILTER_OPS.forEach((op, i) => registerCommand(opCommand(op, 100 + i * 10)));

  registerCommand({
    id: "filter.last",
    label: "Last Filter",
    menu: "Filter",
    order: 0,
    shortcut: "CmdOrCtrl+F",
    keywords: ["repeat", "again"],
    enabled: () => rasterLayerEnabled() && getLastFilter() !== null,
    run: guarded(() => {
      const last = getLastFilter();
      if (last) applyOpToActiveLayer(last.op, last.params);
    }),
  });

  // ---- Edit / Free Transform
  registerCommand({
    id: "edit.transform",
    label: "Free Transform",
    menu: "Edit",
    order: 300,
    shortcut: "CmdOrCtrl+T",
    keywords: ["scale", "rotate", "move", "resize"],
    enabled: rasterLayerEnabled,
    run: () => {
      closeDialog();
      if (transformSession.active) return;
      transformSession.begin();
    },
  });

  // ---- Image
  registerCommand({
    id: "image.size",
    label: "Image Size…",
    menu: "Image",
    order: 100,
    shortcut: "CmdOrCtrl+Alt+I",
    keywords: ["resample", "resize", "scale"],
    enabled: docEnabled,
    run: guarded(() => openDialog(ImageSizeDialog, {})),
  });
  registerCommand({
    id: "image.canvasSize",
    label: "Canvas Size…",
    menu: "Image",
    order: 110,
    shortcut: "CmdOrCtrl+Alt+C",
    keywords: ["anchor", "extend", "crop"],
    enabled: docEnabled,
    run: guarded(() => openDialog(CanvasSizeDialog, {})),
  });
  registerCommand({
    id: "image.trim",
    label: "Trim",
    menu: "Image",
    order: 130,
    keywords: ["crop", "transparent", "autocrop"],
    enabled: docEnabled,
    run: guarded(() => {
      const entry = docStore.active;
      if (!entry) return;
      const doc = rawDoc(entry);
      const r = trimRect(doc, { basis: "transparent" }) ?? trimRect(doc, { basis: "top-left" });
      if (r) docStore.exec(new CropCanvasCommand(r));
    }),
  });

  // ---- Image / Rotate
  const rot = (id: string, label: string, order: number, make: () => RotateImageCommand | FlipImageCommand, keywords: string[]): void =>
    registerCommand({ id, label, menu: "Image/Rotate", order, keywords, enabled: docEnabled, run: guarded(() => docStore.exec(make())) });
  rot("image.rotate180", "180°", 200, () => new RotateImageCommand("180"), ["rotate", "canvas"]);
  rot("image.rotate90cw", "90° Clockwise", 210, () => new RotateImageCommand("90cw"), ["rotate", "canvas"]);
  rot("image.rotate90ccw", "90° Counter-clockwise", 220, () => new RotateImageCommand("90ccw"), ["rotate", "canvas"]);
  registerCommand({
    id: "image.rotateCanvas",
    label: "Arbitrary…",
    menu: "Image/Rotate",
    order: 230,
    keywords: ["rotate", "angle", "canvas"],
    enabled: docEnabled,
    run: guarded(() => openDialog(RotateCanvasDialog, {})),
  });
  rot("image.flipH", "Flip Canvas Horizontal", 300, () => new FlipImageCommand("h"), ["mirror", "flip"]);
  rot("image.flipV", "Flip Canvas Vertical", 310, () => new FlipImageCommand("v"), ["mirror", "flip"]);

  // ---- Layer / Transform
  const layerCmd = (id: string, label: string, order: number, run: (layerId: string) => void): void =>
    registerCommand({
      id,
      label,
      menu: "Layer/Transform",
      order,
      keywords: ["layer", "flip", "rotate"],
      enabled: rasterLayerEnabled,
      run: guarded(() => {
        const l = docStore.activeLayer;
        if (l && l.kind === "raster") run(l.id);
      }),
    });
  const raw = (): ReturnType<typeof rawDoc> => rawDoc(docStore.active!);
  layerCmd("layer.flipH", "Flip Horizontal", 100, (id) => docStore.exec(flipLayerCommand(raw(), id, "h")));
  layerCmd("layer.flipV", "Flip Vertical", 110, (id) => docStore.exec(flipLayerCommand(raw(), id, "v")));
  layerCmd("layer.rotate90cw", "Rotate 90° Clockwise", 120, (id) => docStore.exec(rotateLayer90Command(raw(), id, true)));
  layerCmd("layer.rotate90ccw", "Rotate 90° Counter-clockwise", 130, (id) => docStore.exec(rotateLayer90Command(raw(), id, false)));
}

let overlayMounted = false;

/** Mount the Free Transform overlay on `document.body` (idempotent). */
export function mountTransformOverlay(): void {
  if (overlayMounted || typeof document === "undefined") return;
  overlayMounted = true;
  const target = document.createElement("div");
  target.className = "pf-transform-overlay-host";
  document.body.appendChild(target);
  mount(TransformOverlay, { target });
}

registerFilterCommands();
mountTransformOverlay();
