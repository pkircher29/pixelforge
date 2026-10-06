/**
 * Pure model behind the Layers panel: the row list (indentation, clipping arrows,
 * effect sub-rows, filtering), multi-select math, context-menu enablement and the
 * handful of UI-side commands the engine does not ship (batches, reparenting,
 * rasterize, visibility sets). No Svelte here — everything is unit-testable.
 */
import {
  Raster,
  Rect,
  Selection,
  SetLayerPropsCommand,
  StructuralCommand,
  layerBlock,
  layerIndex,
  moveLayer,
  rasterizeLayer,
  findLayer,
  clipBaseOf,
  type Command,
  type Document,
  type Layer,
  type LayerEffects,
  type LayerId,
  type Point,
} from "$lib/engine";
import type { FilterMode, KindFilter } from "./Layers.store.svelte";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const EFFECT_ORDER = ["bevelEmboss", "stroke", "innerShadow", "innerGlow", "colorOverlay", "gradientOverlay", "outerGlow", "dropShadow"] as const;
export type EffectKey = (typeof EFFECT_ORDER)[number];

export const EFFECT_LABEL: Record<EffectKey, string> = {
  bevelEmboss: "Bevel & Emboss",
  stroke: "Stroke",
  innerShadow: "Inner Shadow",
  innerGlow: "Inner Glow",
  colorOverlay: "Color Overlay",
  gradientOverlay: "Gradient Overlay",
  outerGlow: "Outer Glow",
  dropShadow: "Drop Shadow",
};

export interface LayerRowModel {
  kind: "layer";
  layer: Layer;
  id: LayerId;
  /** Engine index. */
  index: number;
  /** 0 = top level, 1 = inside a group. */
  depth: number;
  isGroup: boolean;
  collapsed: boolean;
  clipped: boolean;
  hasMask: boolean;
  maskEnabled: boolean;
  hasEffects: boolean;
  effectsExpanded: boolean;
  locked: boolean;
  anyLock: boolean;
  visible: boolean;
  name: string;
  color: Layer["color"];
  /** Row does not pass the filter (rendered dimmed when filtering by name). */
  selected: boolean;
  active: boolean;
}

export interface EffectsHeaderRow {
  kind: "effects";
  layer: Layer;
  id: string;
  depth: number;
  clipped: boolean;
  /** Any effect enabled (the header's eye). */
  visible: boolean;
}

export interface EffectRow {
  kind: "effect";
  layer: Layer;
  id: string;
  depth: number;
  clipped: boolean;
  effect: EffectKey;
  label: string;
  visible: boolean;
}

export type PanelRow = LayerRowModel | EffectsHeaderRow | EffectRow;

export interface RowFilter {
  on: boolean;
  mode: FilterMode;
  kinds: readonly KindFilter[];
  name: string;
  color: string | null;
}

export const NO_FILTER: RowFilter = { on: false, mode: "kind", kinds: [], name: "", color: null };

/** Kind-filter bucket of a layer (`null` for groups, which are never filtered out). */
export function kindOf(layer: Layer): KindFilter | null {
  switch (layer.kind) {
    case "raster":
      return "pixel";
    case "adjustment":
    case "fill":
      return "adjustment";
    case "text":
      return "type";
    case "shape":
      return "shape";
    default:
      return null;
  }
}

/** Does the layer pass the filter row? Groups pass when any child passes (handled by the caller). */
export function passesFilter(layer: Layer, f: RowFilter): boolean {
  if (!f.on) return true;
  if (f.mode === "kind") {
    if (f.kinds.length === 0) return true;
    const k = kindOf(layer);
    return k === null ? false : f.kinds.includes(k);
  }
  if (f.mode === "name") {
    const q = f.name.trim().toLowerCase();
    return q === "" || layer.name.toLowerCase().includes(q);
  }
  if (f.mode === "color") return f.color === null || layer.color === f.color;
  return true;
}

export interface BuildRowsOptions {
  filter?: RowFilter;
  expandedEffects?: readonly LayerId[];
  selected?: readonly LayerId[];
}

/** Any effect in `e` enabled? */
export function anyEffectEnabled(e: LayerEffects | null): boolean {
  return !!e && EFFECT_ORDER.some((k) => e[k]?.enabled);
}

/** Effects present on a layer (enabled or not), in PS panel order. */
export function presentEffects(e: LayerEffects | null): EffectKey[] {
  return e ? EFFECT_ORDER.filter((k) => e[k] !== undefined) : [];
}

/**
 * Rows top-to-bottom (engine order reversed). Children of collapsed groups are skipped;
 * filtered-out layers are skipped (a group stays when any child passes); a layer with
 * effects contributes an "Effects" header row plus one row per present effect when
 * expanded.
 */
export function buildRows(doc: Document, opts: BuildRowsOptions = {}): PanelRow[] {
  const filter = opts.filter ?? NO_FILTER;
  const expanded = new Set(opts.expandedEffects ?? []);
  const selected = new Set(opts.selected ?? []);
  const layers = doc.layers;
  const collapsed = new Set(layers.filter((l) => l.kind === "group" && l.collapsed).map((l) => l.id));
  const groupPasses = new Map<LayerId, boolean>();
  for (const l of layers) if (l.parentId && passesFilter(l, filter)) groupPasses.set(l.parentId, true);
  const out: PanelRow[] = [];
  // Panel order: top-most first. A group's children sit *after* the group in engine
  // order (higher indices), but PS lists the group header above them, so a group emits
  // itself and then its children, top to bottom.
  const order: number[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (l.parentId) continue; // emitted by its group
    order.push(i);
    if (l.kind === "group" && !l.collapsed) {
      let end = i + 1;
      while (end < layers.length && layers[end]!.parentId === l.id) end++;
      for (let j = end - 1; j > i; j--) order.push(j);
    }
  }
  for (const i of order) {
    const l = layers[i]!;
    if (l.parentId && collapsed.has(l.parentId)) continue;
    if (l.kind === "group") {
      if (filter.on && !(filter.mode === "kind" && filter.kinds.length === 0) && !groupPasses.get(l.id) && !passesFilter(l, filter)) continue;
    } else if (!passesFilter(l, filter)) continue;
    const depth = l.parentId ? 1 : 0;
    const clipped = l.clipToBelow && l.kind !== "group" && clipBaseOf(doc, l.id) !== null;
    const hasEffects = presentEffects(l.effects).length > 0;
    out.push({
      kind: "layer",
      layer: l,
      id: l.id,
      index: i,
      depth,
      isGroup: l.kind === "group",
      collapsed: l.kind === "group" && l.collapsed,
      clipped,
      hasMask: l.mask !== null,
      maskEnabled: l.maskEnabled,
      hasEffects,
      effectsExpanded: hasEffects && expanded.has(l.id),
      locked: l.lock.all || l.locked,
      anyLock: l.lock.all || l.locked || l.lock.pixels || l.lock.position || l.lock.transparent,
      visible: l.visible,
      name: l.name,
      color: l.color,
      selected: selected.has(l.id) || l.id === doc.activeLayerId,
      active: l.id === doc.activeLayerId,
    });
    if (hasEffects && expanded.has(l.id)) {
      out.push({ kind: "effects", layer: l, id: `${l.id}:fx`, depth, clipped, visible: anyEffectEnabled(l.effects) });
      for (const k of presentEffects(l.effects)) {
        out.push({ kind: "effect", layer: l, id: `${l.id}:fx:${k}`, depth, clipped, effect: k, label: EFFECT_LABEL[k], visible: !!l.effects![k]?.enabled });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface ClickModifiers {
  ctrl?: boolean;
  shift?: boolean;
}

/**
 * Multi-select rules (PS): plain click selects one; Ctrl toggles; Shift selects the
 * range between the anchor (active layer) and the clicked row in panel order.
 * Returns the new selection and the new active id.
 */
export function selectOnClick(visibleIds: readonly LayerId[], current: readonly LayerId[], activeId: LayerId | null, clicked: LayerId, mods: ClickModifiers): { selected: LayerId[]; active: LayerId } {
  if (mods.shift && activeId && visibleIds.includes(activeId)) {
    const a = visibleIds.indexOf(activeId);
    const b = visibleIds.indexOf(clicked);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = visibleIds.slice(lo, hi + 1);
    const base = mods.ctrl ? current.filter((id) => !range.includes(id)) : [];
    return { selected: [...new Set([...base, ...range])], active: clicked };
  }
  if (mods.ctrl) {
    const set = new Set(current);
    if (activeId) set.add(activeId);
    if (set.has(clicked) && set.size > 1) {
      set.delete(clicked);
      const rest = [...set];
      const nextActive = activeId && activeId !== clicked ? activeId : rest[rest.length - 1]!;
      return { selected: rest, active: nextActive };
    }
    set.add(clicked);
    return { selected: [...set], active: clicked };
  }
  return { selected: [clicked], active: clicked };
}

/** The layers a command operates on: the multi-selection, else just the active one. */
export function targetLayers(doc: Document, selected: readonly LayerId[]): Layer[] {
  const ids = new Set(selected);
  if (doc.activeLayerId) ids.add(doc.activeLayerId);
  return doc.layers.filter((l) => ids.has(l.id));
}

// ---------------------------------------------------------------------------
// Context menu enablement
// ---------------------------------------------------------------------------

export interface ContextMenuState {
  blendingOptions: boolean;
  duplicate: boolean;
  delete: boolean;
  groupFromLayers: boolean;
  convertToSmart: boolean;
  rasterizeType: boolean;
  rasterizeShape: boolean;
  createClippingMask: boolean;
  releaseClippingMask: boolean;
  linkLayers: boolean;
  unlinkLayers: boolean;
  selectLinked: boolean;
  mergeDown: boolean;
  mergeVisible: boolean;
  flatten: boolean;
}

/** Nearest sibling below a layer (same parent), or null. */
export function siblingBelow(doc: Document, l: Layer): Layer | null {
  const i = layerIndex(doc, l.id);
  for (let j = i - 1; j >= 0; j--) {
    const b = doc.layers[j]!;
    if (b.parentId === l.parentId) return b;
  }
  return null;
}

export function canMergeDown(doc: Document, l: Layer): boolean {
  const below = siblingBelow(doc, l);
  return !!below && below.kind !== "group" && below.kind !== "adjustment";
}

export function canClip(doc: Document, l: Layer): boolean {
  if (l.kind === "group") return false;
  const below = siblingBelow(doc, l);
  return !!below && below.kind !== "group";
}

export function contextMenuState(doc: Document, l: Layer, selected: readonly LayerId[]): ContextMenuState {
  const targets = targetLayers(doc, selected);
  const multi = targets.length > 1;
  return {
    blendingOptions: l.kind !== "group",
    duplicate: true,
    delete: doc.layers.length > targets.length,
    groupFromLayers: targets.every((t) => t.kind !== "group" && t.parentId === null),
    convertToSmart: false,
    rasterizeType: l.kind === "text",
    rasterizeShape: l.kind === "shape",
    createClippingMask: !l.clipToBelow && canClip(doc, l),
    releaseClippingMask: l.clipToBelow,
    linkLayers: multi,
    unlinkLayers: l.linkedTo.length > 0,
    selectLinked: l.linkedTo.length > 0,
    mergeDown: !multi && canMergeDown(doc, l),
    mergeVisible: doc.layers.filter((x) => x.visible).length > 1,
    flatten: doc.layers.length > 1,
  };
}

// ---------------------------------------------------------------------------
// UI-side commands
// ---------------------------------------------------------------------------

/** Run several commands as one history entry. */
export class BatchCommand implements Command {
  readonly label: string;
  private readonly cmds: Command[];

  constructor(label: string, cmds: Command[]) {
    this.label = label;
    this.cmds = cmds;
  }

  do(doc: Document): void {
    for (const c of this.cmds) c.do(doc);
  }

  undo(doc: Document): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i]!.undo(doc);
  }

  byteSize(): number {
    return this.cmds.reduce((n, c) => n + (c.byteSize?.() ?? 0), 0);
  }

  affected() {
    return this.cmds.flatMap((c) => c.affected?.() ?? []);
  }
}

/** Set `visible` on many layers at once (solo / hide layers / delete hidden). */
export class SetLayersVisibleCommand implements Command {
  readonly label: string;
  private readonly next: Record<LayerId, boolean>;
  private prev: Record<LayerId, boolean> = {};

  constructor(next: Record<LayerId, boolean>, label = "Layer Visibility") {
    this.next = { ...next };
    this.label = label;
  }

  do(doc: Document): void {
    for (const [id, v] of Object.entries(this.next)) {
      const l = findLayer(doc, id);
      if (!l) continue;
      this.prev[id] = l.visible;
      l.visible = v;
    }
    doc.dirty = true;
  }

  undo(doc: Document): void {
    for (const [id, v] of Object.entries(this.prev)) {
      const l = findLayer(doc, id);
      if (l) l.visible = v;
    }
    doc.dirty = true;
  }
}

/**
 * Move a layer block to `toIndex` (index after removal, see `layer-reorder.ts`) and set
 * its parent (drag into / out of a group). Children of a moved group keep their parent.
 */
export class MoveLayerToCommand implements Command {
  readonly label = "Layer Order";
  readonly layerId: LayerId;
  private readonly toIndex: number;
  private readonly parentId: LayerId | null;
  private prev: { index: number; parentId: LayerId | null; clip: boolean } | null = null;

  constructor(layerId: LayerId, toIndex: number, parentId: LayerId | null) {
    this.layerId = layerId;
    this.toIndex = toIndex;
    this.parentId = parentId;
  }

  do(doc: Document): void {
    const l = findLayer(doc, this.layerId);
    if (!l) return;
    if (!this.prev) this.prev = { index: layerIndex(doc, l.id), parentId: l.parentId, clip: l.clipToBelow };
    if (l.kind !== "group") l.parentId = this.parentId;
    moveLayer(doc, l.id, this.toIndex);
    // A clipped layer dragged somewhere else becomes a plain layer (PS releases the clip).
    if (l.clipToBelow && !clipBaseOf(doc, l.id)) l.clipToBelow = false;
  }

  undo(doc: Document): void {
    const l = findLayer(doc, this.layerId);
    if (!l || !this.prev) return;
    if (l.kind !== "group") l.parentId = this.prev.parentId;
    l.clipToBelow = this.prev.clip;
    moveLayer(doc, l.id, this.prev.index);
  }
}

/** Layer ▸ Rasterize. */
export class RasterizeLayerCommand extends StructuralCommand {
  readonly label: string;
  private readonly ids: LayerId[];

  constructor(ids: readonly LayerId[], label = "Rasterize Layer") {
    super();
    this.ids = [...ids];
    this.label = label;
  }

  protected apply(doc: Document): void {
    for (const id of this.ids) {
      const l = findLayer(doc, id);
      if (l && (l.kind === "shape" || l.kind === "text" || l.kind === "fill")) rasterizeLayer(doc, id);
    }
  }
}

/** Layer ▸ Delete ▸ Hidden Layers, as a structural snapshot. */
export class DeleteLayersCommand extends StructuralCommand {
  readonly label: string;
  private readonly ids: LayerId[];

  constructor(ids: readonly LayerId[], label = "Delete Layers") {
    super();
    this.ids = [...ids];
    this.label = label;
  }

  protected apply(doc: Document): void {
    const drop = new Set<LayerId>();
    for (const id of this.ids) {
      const l = findLayer(doc, id);
      if (!l) continue;
      drop.add(id);
      if (l.kind === "group") for (const c of doc.layers) if (c.parentId === id) drop.add(c.id);
    }
    if (drop.size >= doc.layers.length) {
      // Keep at least one layer: PS refuses to delete the last one.
      const keep = doc.layers.find((l) => !drop.has(l.id)) ?? doc.layers[0]!;
      drop.delete(keep.id);
    }
    doc.layers = doc.layers.filter((l) => !drop.has(l.id));
    for (const l of doc.layers) l.linkedTo = l.linkedTo.filter((x) => !drop.has(x));
    if (!doc.activeLayerId || drop.has(doc.activeLayerId)) doc.activeLayerId = doc.layers[doc.layers.length - 1]?.id ?? null;
    doc.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Pixel helpers (Layer via Copy / Cut, align)
// ---------------------------------------------------------------------------

/** Copy of a pixel layer's raster with alpha multiplied by the selection (empty = everything). */
export function rasterInsideSelection(raster: Raster, offset: Point, sel: Selection, invert = false): Raster {
  const out = raster.clone();
  if (sel.isEmpty && !invert) return out;
  const d = out.data;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let v = sel.isEmpty ? 255 : sel.get(x + offset.x, y + offset.y);
      if (invert) v = 255 - v;
      const i = (y * out.width + x) * 4 + 3;
      d[i] = (d[i]! * v) / 255;
    }
  }
  return out;
}

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Content bounds (alpha > 0) of a pixel layer in document space, or its full rect. */
export function contentRect(l: Layer): Rect | null {
  if (!(l.kind === "raster" || l.kind === "shape" || l.kind === "text")) return null;
  const bb = l.raster.boundingBoxOfAlpha(0) ?? l.raster.bounds();
  return Rect.make(bb.x + l.offset.x, bb.y + l.offset.y, bb.w, bb.h);
}

/** New offsets that align each layer's content to `target`. */
export function alignOffsets(layers: readonly Layer[], target: Rect, kind: AlignKind): { id: LayerId; offset: Point }[] {
  const out: { id: LayerId; offset: Point }[] = [];
  for (const l of layers) {
    const r = contentRect(l);
    if (!r) continue;
    let dx = 0;
    let dy = 0;
    if (kind === "left") dx = target.x - r.x;
    else if (kind === "hcenter") dx = Math.round(target.x + target.w / 2 - (r.x + r.w / 2));
    else if (kind === "right") dx = target.x + target.w - (r.x + r.w);
    else if (kind === "top") dy = target.y - r.y;
    else if (kind === "vcenter") dy = Math.round(target.y + target.h / 2 - (r.y + r.h / 2));
    else dy = target.y + target.h - (r.y + r.h);
    if (dx || dy) out.push({ id: l.id, offset: { x: l.offset.x + dx, y: l.offset.y + dy } });
  }
  return out;
}

/** Distribute ≥ 3 layers evenly between the outermost ones along an axis (PS "Distribute Horizontal/Vertical Centers"). */
export function distributeOffsets(layers: readonly Layer[], axis: "h" | "v"): { id: LayerId; offset: Point }[] {
  const items = layers.map((l) => ({ l, r: contentRect(l) })).filter((x): x is { l: Layer; r: Rect } => !!x.r);
  if (items.length < 3) return [];
  const center = (r: Rect) => (axis === "h" ? r.x + r.w / 2 : r.y + r.h / 2);
  items.sort((a, b) => center(a.r) - center(b.r));
  const first = center(items[0]!.r);
  const last = center(items[items.length - 1]!.r);
  const step = (last - first) / (items.length - 1);
  const out: { id: LayerId; offset: Point }[] = [];
  items.forEach((it, i) => {
    const d = Math.round(first + step * i - center(it.r));
    if (d) out.push({ id: it.l.id, offset: axis === "h" ? { x: it.l.offset.x + d, y: it.l.offset.y } : { x: it.l.offset.x, y: it.l.offset.y + d } });
  });
  return out;
}

/** Wrap offset updates in a single history entry. */
export function offsetsCommand(label: string, updates: readonly { id: LayerId; offset: Point }[]): BatchCommand {
  return new BatchCommand(label, updates.map((u) => new SetLayerPropsCommand(u.id, { offset: u.offset }, label)));
}

/** Engine block length of a layer (group + children). */
export function blockLength(doc: Document, id: LayerId): number {
  const b = layerBlock(doc, id);
  return b.end - b.start;
}
