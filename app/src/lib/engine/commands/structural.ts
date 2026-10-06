/**
 * Base class for commands that rearrange the layer stack or replace whole rasters
 * (merge, flatten, group, canvas/image size). They snapshot the document's structure
 * before and after the first `do`; `undo` / redo restore the snapshots instead of
 * re-running the operation, which keeps them exact and cheap.
 */

import type { Point } from "../rect";
import type { Raster } from "../raster";
import type { Selection } from "../selection";
import type { BlendMode, Command, Document, Layer, LayerId } from "../types";

interface LayerState {
  raster: Raster | null;
  offset: Point;
  mask: Raster | null;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  parentId: LayerId | null;
  name: string;
}

interface DocSnapshot {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: LayerId | null;
  selection: Selection;
  states: Map<LayerId, LayerState>;
}

function snapshot(doc: Document): DocSnapshot {
  const states = new Map<LayerId, LayerState>();
  for (const l of doc.layers) {
    states.set(l.id, {
      raster: l.raster,
      offset: { x: l.offset.x, y: l.offset.y },
      mask: l.mask,
      opacity: l.opacity,
      blendMode: l.blendMode,
      visible: l.visible,
      parentId: l.parentId,
      name: l.name,
    });
  }
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.slice(),
    activeLayerId: doc.activeLayerId,
    selection: doc.selection,
    states,
  };
}

function restore(doc: Document, s: DocSnapshot): void {
  doc.width = s.width;
  doc.height = s.height;
  doc.layers = s.layers.slice();
  doc.activeLayerId = s.activeLayerId;
  doc.selection = s.selection;
  for (const l of doc.layers) {
    const st = s.states.get(l.id);
    if (!st) continue;
    if (l.kind === "raster" && st.raster) l.raster = st.raster;
    l.offset = { x: st.offset.x, y: st.offset.y };
    l.mask = st.mask;
    l.opacity = st.opacity;
    l.blendMode = st.blendMode;
    l.visible = st.visible;
    l.parentId = st.parentId;
    l.name = st.name;
  }
  doc.dirty = true;
}

export abstract class StructuralCommand implements Command {
  abstract readonly label: string;
  private before: DocSnapshot | null = null;
  private after: DocSnapshot | null = null;

  /** Perform the operation on the document (called exactly once). */
  protected abstract apply(doc: Document): void;

  do(doc: Document): void {
    if (this.after) {
      restore(doc, this.after);
      return;
    }
    this.before = snapshot(doc);
    this.apply(doc);
    this.after = snapshot(doc);
  }

  undo(doc: Document): void {
    if (this.before) restore(doc, this.before);
  }

  /** Bytes of rasters referenced by exactly one of the two snapshots. */
  byteSize(): number {
    if (!this.before || !this.after) return 0;
    const b = rasterSet(this.before);
    const a = rasterSet(this.after);
    let n = 0;
    for (const r of b) if (!a.has(r)) n += r.byteLength();
    for (const r of a) if (!b.has(r)) n += r.byteLength();
    if (this.before.selection !== this.after.selection) n += this.after.selection.byteLength();
    return n;
  }
}

function rasterSet(s: DocSnapshot): Set<Raster> {
  const set = new Set<Raster>();
  for (const st of s.states.values()) {
    if (st.raster) set.add(st.raster);
    if (st.mask) set.add(st.mask);
  }
  return set;
}
