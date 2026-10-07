/** Work-path helpers shared by the Pen, Shape and Path Selection tools (undo-safe commits + live previews). */
import { SetPathsCommand, clonePath, setPathCommand, type Path } from "$lib/engine";
import type { ToolContext } from "./types";
import { emptyWorkPath } from "./path-edit";

/** The document's work path (or an empty one that is not yet in the document). */
export function workPathOf(ctx: ToolContext): Path {
  const d = ctx.doc;
  const p = d.workPathId ? d.paths.find((x) => x.id === d.workPathId) : undefined;
  return p ?? emptyWorkPath();
}

/**
 * Replace the work path as an undoable step. `before` is restored into the document first
 * (live previews mutate it) so the command's undo snapshot is exact. An empty `after`
 * removes the work path.
 */
export function commitWorkPath(ctx: ToolContext, before: Path, after: Path, label: string): void {
  const d = ctx.doc;
  const i = d.paths.findIndex((p) => p.id === before.id);
  if (i >= 0) d.paths[i] = clonePath(before);
  if (after.subpaths.length === 0) {
    if (i < 0) return;
    const next = d.paths.filter((p) => p.id !== after.id);
    ctx.exec(new SetPathsCommand(next, d.workPathId === after.id ? null : d.workPathId, label), { noMerge: true });
    return;
  }
  ctx.exec(setPathCommand(d, after, label), { noMerge: true });
  if (!d.workPathId) {
    d.workPathId = after.id;
    ctx.touch();
  }
}

/** Mutate the live work path for previews (no history). */
export function previewWorkPath(ctx: ToolContext, path: Path): void {
  const d = ctx.doc;
  const i = d.paths.findIndex((p) => p.id === path.id);
  if (i >= 0) d.paths[i] = path;
  else {
    d.paths.push(path);
    if (!d.workPathId) d.workPathId = path.id;
  }
  ctx.touch();
}
