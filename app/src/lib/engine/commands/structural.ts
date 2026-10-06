/**
 * Base class for commands that rearrange the layer stack or replace whole rasters
 * (merge, flatten, group, canvas/image size). They snapshot the document's structure
 * before and after the first `do`; `undo` / redo restore the snapshots instead of
 * re-running the operation, which keeps them exact and cheap.
 */

import type { Point } from "../rect";
import type { Raster } from "../raster";
import type { Selection } from "../selection";
import type { AlphaChannel, BlendMode, Command, Document, Layer, LayerEffects, LayerId, LayerLock, Path } from "../types";

interface LayerState {
  raster: Raster | null;
  offset: Point;
  mask: Raster | null;
  maskEnabled: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  visible: boolean;
  parentId: LayerId | null;
  name: string;
  clipToBelow: boolean;
  effects: LayerEffects | null;
  lock: LayerLock;
  linkedTo: LayerId[];
}

interface DocSnapshot {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: LayerId | null;
  selection: Selection;
  states: Map<LayerId, LayerState>;
  alphaChannels: AlphaChannel[];
  paths: Path[];
  workPathId: string | null;
  quickMaskRaster: Raster | null;
}

function snapshot(doc: Document): DocSnapshot {
  const states = new Map<LayerId, LayerState>();
  for (const l of doc.layers) {
    states.set(l.id, {
      raster: l.raster,
      offset: { x: l.offset.x, y: l.offset.y },
      mask: l.mask,
      maskEnabled: l.maskEnabled,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      blendMode: l.blendMode,
      visible: l.visible,
      parentId: l.parentId,
      name: l.name,
      clipToBelow: l.clipToBelow,
      effects: l.effects,
      lock: { ...l.lock },
      linkedTo: l.linkedTo.slice(),
    });
  }
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.slice(),
    activeLayerId: doc.activeLayerId,
    selection: doc.selection,
    states,
    alphaChannels: doc.alphaChannels.map((c) => ({ ...c })),
    paths: doc.paths.slice(),
    workPathId: doc.workPathId,
    quickMaskRaster: doc.quickMask.raster,
  };
}

function restore(doc: Document, s: DocSnapshot): void {
  doc.width = s.width;
  doc.height = s.height;
  doc.layers = s.layers.slice();
  doc.activeLayerId = s.activeLayerId;
  doc.selection = s.selection;
  doc.alphaChannels = s.alphaChannels.map((c) => ({ ...c }));
  doc.paths = s.paths.slice();
  doc.workPathId = s.workPathId;
  doc.quickMask.raster = s.quickMaskRaster;
  for (const l of doc.layers) {
    const st = s.states.get(l.id);
    if (!st) continue;
    if ((l.kind === "raster" || l.kind === "shape" || l.kind === "text") && st.raster) l.raster = st.raster;
    l.offset = { x: st.offset.x, y: st.offset.y };
    l.mask = st.mask;
    l.maskEnabled = st.maskEnabled;
    l.opacity = st.opacity;
    l.fillOpacity = st.fillOpacity;
    l.blendMode = st.blendMode;
    l.visible = st.visible;
    l.parentId = st.parentId;
    l.name = st.name;
    l.clipToBelow = st.clipToBelow;
    l.effects = st.effects;
    l.lock = { ...st.lock };
    l.linkedTo = st.linkedTo.slice();
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
  for (const c of s.alphaChannels) set.add(c.mask);
  if (s.quickMaskRaster) set.add(s.quickMaskRaster);
  return set;
}
