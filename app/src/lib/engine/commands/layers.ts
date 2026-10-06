/**
 * Layer-stack commands: add, remove, duplicate, reorder, set props, group.
 */

import {
  addLayer,
  duplicateLayer,
  groupLayers,
  layerIndex,
  moveLayer,
  removeLayer,
  setLayerProps,
  ungroupLayers,
} from "../document";
import type { Command, Document, Layer, LayerId, LayerProps } from "../types";
import { StructuralCommand } from "./structural";

export class AddLayerCommand implements Command {
  readonly label: string;
  readonly layer: Layer;
  private index: number | undefined;
  private prevActive: LayerId | null = null;

  constructor(layer: Layer, index?: number, label?: string) {
    this.layer = layer;
    this.index = index;
    this.label = label ?? (layer.kind === "group" ? "New Group" : "New Layer");
  }

  do(doc: Document): void {
    this.prevActive = doc.activeLayerId;
    this.index = addLayer(doc, this.layer, this.index);
  }

  undo(doc: Document): void {
    removeLayer(doc, this.layer.id);
    doc.activeLayerId = this.prevActive;
  }

  byteSize(): number {
    return this.layer.kind === "raster" ? this.layer.raster.byteLength() : 0;
  }
}

export class RemoveLayerCommand implements Command {
  readonly label = "Delete Layer";
  readonly layerId: LayerId;
  private removed: { index: number; layers: Layer[] } | null = null;
  private prevActive: LayerId | null = null;

  constructor(layerId: LayerId) {
    this.layerId = layerId;
  }

  do(doc: Document): void {
    this.prevActive = doc.activeLayerId;
    this.removed = removeLayer(doc, this.layerId);
  }

  undo(doc: Document): void {
    if (!this.removed) return;
    doc.layers.splice(this.removed.index, 0, ...this.removed.layers);
    doc.activeLayerId = this.prevActive;
    doc.dirty = true;
  }

  byteSize(): number {
    let n = 0;
    for (const l of this.removed?.layers ?? []) if (l.kind === "raster") n += l.raster.byteLength();
    return n;
  }
}

export class DuplicateLayerCommand implements Command {
  readonly label = "Duplicate Layer";
  readonly layerId: LayerId;
  private copies: Layer[] = [];
  private index = -1;
  private prevActive: LayerId | null = null;

  constructor(layerId: LayerId) {
    this.layerId = layerId;
  }

  /** Ids of the created copies (valid after the first `do`). */
  get copyIds(): LayerId[] {
    return this.copies.map((l) => l.id);
  }

  do(doc: Document): void {
    this.prevActive = doc.activeLayerId;
    if (this.copies.length === 0) {
      this.copies = duplicateLayer(doc, this.layerId);
      this.index = layerIndex(doc, this.copies[0]!.id);
    } else {
      doc.layers.splice(this.index, 0, ...this.copies);
      doc.activeLayerId = this.copies[0]!.id;
      doc.dirty = true;
    }
  }

  undo(doc: Document): void {
    const ids = new Set(this.copies.map((l) => l.id));
    doc.layers = doc.layers.filter((l) => !ids.has(l.id));
    doc.activeLayerId = this.prevActive;
    doc.dirty = true;
  }

  byteSize(): number {
    let n = 0;
    for (const l of this.copies) if (l.kind === "raster") n += l.raster.byteLength();
    return n;
  }
}

/** Move a layer (with its children) so it starts at `toIndex` after removal. */
export class ReorderLayerCommand implements Command {
  readonly label = "Reorder Layer";
  readonly layerId: LayerId;
  private readonly toIndex: number;
  private fromIndex = -1;

  constructor(layerId: LayerId, toIndex: number) {
    this.layerId = layerId;
    this.toIndex = toIndex;
  }

  do(doc: Document): void {
    this.fromIndex = layerIndex(doc, this.layerId);
    moveLayer(doc, this.layerId, this.toIndex);
  }

  undo(doc: Document): void {
    moveLayer(doc, this.layerId, this.fromIndex);
  }
}

const MERGEABLE_KEYS: ReadonlySet<keyof LayerProps> = new Set(["opacity", "offset"]);

/**
 * Change layer properties. Consecutive changes of the same continuous property
 * (opacity, offset) on the same layer merge into one history entry.
 */
export class SetLayerPropsCommand implements Command {
  readonly label: string;
  readonly layerId: LayerId;
  private next: Partial<LayerProps>;
  private prev: Partial<LayerProps> | null = null;

  constructor(layerId: LayerId, props: Partial<LayerProps>, label?: string) {
    this.layerId = layerId;
    this.next = { ...props };
    this.label = label ?? labelFor(props);
  }

  do(doc: Document): void {
    const prev = setLayerProps(doc, this.layerId, this.next);
    if (!this.prev) this.prev = prev;
  }

  undo(doc: Document): void {
    if (this.prev) setLayerProps(doc, this.layerId, this.prev);
  }

  mergeWith(next: Command): boolean {
    if (!(next instanceof SetLayerPropsCommand) || next.layerId !== this.layerId) return false;
    const mine = Object.keys(this.next) as (keyof LayerProps)[];
    const theirs = Object.keys(next.next) as (keyof LayerProps)[];
    if (mine.length !== theirs.length) return false;
    if (!mine.every((k) => MERGEABLE_KEYS.has(k) && theirs.includes(k))) return false;
    this.next = { ...this.next, ...next.next };
    return true;
  }
}

function labelFor(props: Partial<LayerProps>): string {
  const keys = Object.keys(props);
  if (keys.length === 1) {
    switch (keys[0]) {
      case "name":
        return "Rename Layer";
      case "opacity":
        return "Layer Opacity";
      case "blendMode":
        return "Blend Mode";
      case "visible":
        return props.visible ? "Show Layer" : "Hide Layer";
      case "locked":
        return props.locked ? "Lock Layer" : "Unlock Layer";
      case "offset":
        return "Move Layer";
      case "collapsed":
        return "Toggle Group";
    }
  }
  return "Layer Properties";
}

export class RenameLayerCommand extends SetLayerPropsCommand {
  constructor(layerId: LayerId, name: string) {
    super(layerId, { name }, "Rename Layer");
  }
}

export class GroupLayersCommand extends StructuralCommand {
  readonly label = "Group Layers";
  private readonly ids: readonly LayerId[];
  private readonly name: string | undefined;
  groupId: LayerId | null = null;

  constructor(ids: readonly LayerId[], name?: string) {
    super();
    this.ids = ids;
    this.name = name;
  }

  protected apply(doc: Document): void {
    this.groupId = groupLayers(doc, this.ids, this.name).id;
  }
}

export class UngroupLayersCommand extends StructuralCommand {
  readonly label = "Ungroup Layers";
  private readonly groupId: LayerId;

  constructor(groupId: LayerId) {
    super();
    this.groupId = groupId;
  }

  protected apply(doc: Document): void {
    ungroupLayers(doc, this.groupId);
  }
}
