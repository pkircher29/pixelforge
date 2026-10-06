/**
 * Paths panel actions + palette commands (`paths.*`), shared by the panel body, its
 * ≡ menu and the command palette.
 */
import type { PixelLayer } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import { layersUi } from "./Layers.store.svelte";
import { buildPathRows, fillPathCommand, strokePathCommand, pathSelectionCommand, workPathFromSelectionCommand, newPathCommand, deletePathCommand, duplicatePathCommand, type PathRow } from "./Paths.model";
import PathsMakeSelectionDialog from "./PathsMakeSelectionDialog.svelte";

export function activePathRow(): PathRow | null {
  const d = docStore.doc;
  if (!d) return null;
  return buildPathRows(d, layersUi.activePathId ?? d.workPathId).find((r) => r.active) ?? null;
}

export function pixelTarget(): PixelLayer | null {
  const l = docStore.activeLayer;
  return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l : null;
}

export function fillPath(): void {
  const d = docStore.doc;
  const r = activePathRow();
  const t = pixelTarget();
  if (!d || !r) return;
  if (!t) {
    toast.info("Select a pixel layer to fill the path onto.");
    return;
  }
  docStore.exec(fillPathCommand(d, t, r.path, toolStore.fg));
}

export function strokePath(): void {
  const d = docStore.doc;
  const r = activePathRow();
  const t = pixelTarget();
  if (!d || !r) return;
  if (!t) {
    toast.info("Select a pixel layer to stroke the path onto.");
    return;
  }
  docStore.exec(strokePathCommand(d, t, r.path, toolStore.option("brush", "size", 24), toolStore.fg));
}

export function loadPathSelection(): void {
  const d = docStore.doc;
  const r = activePathRow();
  if (d && r) docStore.exec(pathSelectionCommand(d, r.path));
}

export async function makeSelectionDialog(): Promise<void> {
  const d = docStore.doc;
  const r = activePathRow();
  if (!d || !r) return;
  const res = await openDialog<{ feather: number; aa: boolean; hasSelection: boolean }, { feather: number; aa: boolean; mode: "replace" | "add" | "subtract" | "intersect" }>(PathsMakeSelectionDialog, { feather: 0, aa: true, hasSelection: !d.selection.isEmpty });
  if (res) docStore.exec(pathSelectionCommand(d, r.path, res));
}

export function makeWorkPath(): void {
  const d = docStore.doc;
  if (!d) return;
  const cmd = workPathFromSelectionCommand(d);
  if (!cmd) {
    toast.info("Make a selection first.");
    return;
  }
  docStore.exec(cmd);
  layersUi.activePathId = d.workPathId;
}

export function newPath(): void {
  const d = docStore.doc;
  if (!d) return;
  const { cmd, id } = newPathCommand(d);
  docStore.exec(cmd);
  layersUi.activePathId = id;
}

export function deletePath(): void {
  const d = docStore.doc;
  const r = activePathRow();
  if (!d || !r) return;
  docStore.exec(deletePathCommand(d, r.id));
  layersUi.activePathId = null;
}

export function duplicatePath(): void {
  const d = docStore.doc;
  const r = activePathRow();
  if (!d || !r) return;
  const res = duplicatePathCommand(d, r.id);
  if (res) {
    docStore.exec(res.cmd);
    layersUi.activePathId = res.id;
  }
}

const hasSel = () => !!docStore.doc && !docStore.doc.selection.isEmpty;

registerCommands([
  { id: "paths.new", label: "New Path…", enabled: () => !!docStore.doc, run: newPath },
  { id: "paths.duplicate", label: "Duplicate Path…", enabled: () => !!activePathRow(), run: duplicatePath },
  { id: "paths.delete", label: "Delete Path", enabled: () => !!activePathRow(), run: deletePath },
  { id: "paths.makeWork", label: "Make Work Path…", enabled: hasSel, run: makeWorkPath },
  { id: "paths.makeSelection", label: "Make Selection…", enabled: () => !!activePathRow(), run: () => void makeSelectionDialog() },
  { id: "paths.fill", label: "Fill Path…", enabled: () => !!activePathRow() && !!pixelTarget(), run: fillPath },
  { id: "paths.stroke", label: "Stroke Path…", enabled: () => !!activePathRow() && !!pixelTarget(), run: strokePath },
  { id: "paths.clipping", label: "Clipping Path…", enabled: () => false, run: () => {} },
]);
