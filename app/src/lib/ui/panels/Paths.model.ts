/**
 * Paths panel model (pure): rows (Work Path first, italic), and the path → pixels /
 * selection operations wired to the engine's vector ops.
 */
import { Raster, ReplaceLayerPixelsCommand, SetPathsCommand, SetSelectionCommand, fillPathToRaster, newPath, pathToSelection, selectionToPath, strokePathToRaster, type Command, type Document, type Path, type PixelLayer, type RGBA } from "$lib/engine";

export interface PathRow {
  id: string;
  name: string;
  isWork: boolean;
  active: boolean;
  path: Path;
}

export function buildPathRows(doc: Document, activeId: string | null): PathRow[] {
  const rows = doc.paths.map((p) => ({ id: p.id, name: p.id === doc.workPathId ? "Work Path" : p.name, isWork: p.id === doc.workPathId, active: p.id === activeId, path: p }));
  // Work Path is listed last in PS (saved paths above it).
  return [...rows.filter((r) => !r.isWork), ...rows.filter((r) => r.isWork)];
}

/** Composite a document-sized raster over a pixel layer (its own raster space). */
function blitOnto(layer: PixelLayer, src: Raster): Raster {
  const out = layer.raster.clone();
  out.blit(src, -layer.offset.x, -layer.offset.y);
  return out;
}

/** Fill Path with the foreground color onto `layer`. */
export function fillPathCommand(doc: Document, layer: PixelLayer, path: Path, color: RGBA): Command {
  const fill = fillPathToRaster(path, color, doc.width, doc.height, { aa: true });
  return ReplaceLayerPixelsCommand.whole("Fill Path", layer, blitOnto(layer, fill));
}

/** Stroke Path with the brush (size / color from the tool store). */
export function strokePathCommand(doc: Document, layer: PixelLayer, path: Path, width: number, color: RGBA): Command {
  const stroke = strokePathToRaster(path, Math.max(1, width), color, { cap: "round", join: "round", aa: true }, doc.width, doc.height);
  return ReplaceLayerPixelsCommand.whole("Stroke Path", layer, blitOnto(layer, stroke));
}

/** Path → selection (Make Selection…). */
export function pathSelectionCommand(doc: Document, path: Path, opts: { feather?: number; aa?: boolean; mode?: "replace" | "add" | "subtract" | "intersect" } = {}): Command {
  let sel = pathToSelection(path, doc.width, doc.height, { feather: opts.feather ?? 0, aa: opts.aa ?? true });
  const mode = opts.mode ?? "replace";
  if (mode === "add") sel = doc.selection.add(sel);
  else if (mode === "subtract") sel = doc.selection.subtract(sel);
  else if (mode === "intersect") sel = doc.selection.intersect(sel);
  return new SetSelectionCommand(sel, "Make Selection");
}

/** Selection → Work Path (replaces the existing work path). */
export function workPathFromSelectionCommand(doc: Document, tolerance = 2): Command | null {
  if (doc.selection.isEmpty) return null;
  const path = selectionToPath(doc.selection, tolerance, { smooth: true, name: "Work Path" });
  const others = doc.paths.filter((p) => p.id !== doc.workPathId);
  return new SetPathsCommand([...others, path], path.id, "Make Work Path");
}

/** New empty saved path. */
export function newPathCommand(doc: Document, name?: string): { cmd: Command; id: string } {
  const n = doc.paths.filter((p) => p.id !== doc.workPathId).length + 1;
  const p = newPath(name ?? `Path ${n}`);
  return { cmd: new SetPathsCommand([...doc.paths, p], doc.workPathId, "New Path"), id: p.id };
}

/** Save Path…: the work path becomes a named saved path. */
export function savePathCommand(doc: Document, name: string): Command | null {
  if (!doc.workPathId) return null;
  const paths = doc.paths.map((p) => (p.id === doc.workPathId ? { ...p, name } : p));
  return new SetPathsCommand(paths, null, "Save Path");
}

export function deletePathCommand(doc: Document, id: string): Command {
  return new SetPathsCommand(doc.paths.filter((p) => p.id !== id), doc.workPathId === id ? null : doc.workPathId, "Delete Path");
}

export function duplicatePathCommand(doc: Document, id: string): { cmd: Command; id: string } | null {
  const src = doc.paths.find((p) => p.id === id);
  if (!src) return null;
  const copy = newPath(`${src.id === doc.workPathId ? "Path" : src.name} copy`, JSON.parse(JSON.stringify(src.subpaths)) as Path["subpaths"]);
  return { cmd: new SetPathsCommand([...doc.paths, copy], doc.workPathId, "Duplicate Path"), id: copy.id };
}

export function renamePathCommand(doc: Document, id: string, name: string): Command {
  const paths = doc.paths.map((p) => (p.id === id ? { ...p, name } : p));
  return new SetPathsCommand(paths, doc.workPathId === id ? null : doc.workPathId, "Rename Path");
}

