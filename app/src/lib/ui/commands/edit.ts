/** Edit menu. (`edit.transform` / Free Transform belongs to adjust-filters.) */
import { AddLayerCommand, PaintCommand, Rect, Selection, createRasterLayer, activeLayer, type RGBA } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { toast, errorMessage } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import PreferencesDialog from "../dialogs/PreferencesDialog.svelte";
import { copyRegion, readRasterFromClipboard, writeRasterToClipboard } from "$lib/io/clipboard";
import { clearThroughMask, fillThroughMask } from "$lib/tools/paint/fill";
import { nextUntitledName } from "./file";

function paintable() {
  const doc = docStore.doc;
  const l = doc ? activeLayer(doc) : undefined;
  if (!doc || !l || l.kind !== "raster") return null;
  if (l.locked) {
    toast.info(`"${l.name}" is locked.`);
    return null;
  }
  return { doc, layer: l };
}

/** Fill the selection (or whole layer) with a colour. */
export function fillWith(color: RGBA, label: string): void {
  const p = paintable();
  if (!p) return;
  const { doc, layer } = p;
  const mask = doc.selection.isEmpty ? Selection.all(doc.width, doc.height) : doc.selection;
  const bb = mask.bbox!;
  const target = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
  if (Rect.isEmpty(target)) return;
  const captured = PaintCommand.capture(layer, target);
  const touched = fillThroughMask(layer.raster, mask, layer.offset, color);
  if (touched) docStore.exec(PaintCommand.finish(layer, captured, label, touched), { alreadyApplied: true, noMerge: true });
}

export function clearSelection(): void {
  const p = paintable();
  if (!p) return;
  const { doc, layer } = p;
  const mask = doc.selection.isEmpty ? Selection.all(doc.width, doc.height) : doc.selection;
  const bb = mask.bbox!;
  const target = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
  if (Rect.isEmpty(target)) return;
  const captured = PaintCommand.capture(layer, target);
  const touched = clearThroughMask(layer.raster, mask, layer.offset);
  if (touched) docStore.exec(PaintCommand.finish(layer, captured, "Clear", touched), { alreadyApplied: true, noMerge: true });
}

export async function copy(): Promise<boolean> {
  const doc = docStore.doc;
  if (!doc) return false;
  const region = copyRegion(doc);
  if (!region) {
    toast.info("Nothing to copy — the layer is empty.");
    return false;
  }
  try {
    await writeRasterToClipboard(region.raster);
    toast.success("Copied", `${region.raster.width} × ${region.raster.height} px`);
    return true;
  } catch (e) {
    toast.error("Copy failed", errorMessage(e));
    return false;
  }
}

export async function paste(): Promise<void> {
  let raster;
  try {
    raster = await readRasterFromClipboard();
  } catch (e) {
    toast.error("Paste failed", errorMessage(e));
    return;
  }
  if (!raster) {
    toast.info("The clipboard has no image.");
    return;
  }
  const entry = docStore.active;
  if (!entry) {
    const doc = docStore.create({ name: nextUntitledName(), width: raster.width, height: raster.height, noBackgroundLayer: true });
    const layer = createRasterLayer(doc.doc, { name: "Background", raster });
    doc.doc.layers.push(layer);
    doc.doc.activeLayerId = layer.id;
    doc.version++;
    return;
  }
  const doc = entry.doc;
  const layer = createRasterLayer(doc, {
    name: "Pasted",
    raster,
    offset: { x: Math.round((doc.width - raster.width) / 2), y: Math.round((doc.height - raster.height) / 2) },
  });
  docStore.exec(new AddLayerCommand(layer, undefined, "Paste"));
  if (raster.width > doc.width || raster.height > doc.height) toast.info("The pasted image is larger than the canvas — use Move to position it.");
}

registerCommands([
  { id: "edit.undo", label: "Undo", menu: "Edit", order: 100, shortcut: "CmdOrCtrl+Z", enabled: () => !!docStore.active?.history.canUndo, run: () => docStore.undo() },
  { id: "edit.redo", label: "Redo", menu: "Edit", order: 101, shortcut: "CmdOrCtrl+Shift+Z", enabled: () => !!docStore.active?.history.canRedo, run: () => docStore.redo() },
  { id: "edit.redoAlt", label: "Redo", shortcut: "CmdOrCtrl+Y", enabled: () => !!docStore.active?.history.canRedo, run: () => docStore.redo() },
  { id: "edit.cut", label: "Cut", menu: "Edit", order: 200, shortcut: "CmdOrCtrl+X", enabled: () => !!docStore.doc, run: async () => { if (await copy()) clearSelection(); } },
  { id: "edit.copy", label: "Copy", menu: "Edit", order: 201, shortcut: "CmdOrCtrl+C", enabled: () => !!docStore.doc, run: () => copy().then(() => {}) },
  { id: "edit.paste", label: "Paste", menu: "Edit", order: 202, shortcut: "CmdOrCtrl+V", keywords: ["clipboard"], run: paste },
  { id: "edit.clear", label: "Clear", menu: "Edit", order: 203, shortcut: "Delete", keywords: ["erase", "delete pixels"], enabled: () => !!docStore.doc, run: clearSelection },
  { id: "edit.fillFg", label: "Fill with foreground", menu: "Edit", order: 300, shortcut: "Shift+F5", enabled: () => !!docStore.doc, run: () => fillWith(toolStore.fg, "Fill Foreground") },
  { id: "edit.fillBg", label: "Fill with background", menu: "Edit", order: 301, shortcut: "CmdOrCtrl+Backspace", enabled: () => !!docStore.doc, run: () => fillWith(toolStore.bg, "Fill Background") },
  { id: "edit.fillFgAlt", label: "Fill with foreground", shortcut: "Alt+Backspace", enabled: () => !!docStore.doc, run: () => fillWith(toolStore.fg, "Fill Foreground") },
  { id: "edit.preferences", label: "Preferences…", menu: "Edit", order: 900, keywords: ["settings"], run: async () => { await openDialog<Record<string, never>, void>(PreferencesDialog, {}); } },
]);
