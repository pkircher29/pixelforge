/**
 * Document / Layer model and the reference **CPU compositor**.
 *
 * The document is a plain mutable object (see `types.ts`). The functions here are the
 * primitive layer operations that commands build on; they do not record history and
 * they do not notify anyone. Use the commands in `commands/` from UI code.
 */

import { Rect, type Point } from "./rect";
import { Raster } from "./raster";
import { Selection } from "./selection";
import { compositeStraight } from "./blend";
import {
  BlendMode,
  type Document,
  type DocumentMeta,
  type GroupLayer,
  type Layer,
  type LayerId,
  type LayerProps,
  type RasterLayer,
  type RGBA,
} from "./types";

let idCounter = 0;

/** Short unique id (uuid when available, counter-based fallback). */
export function newId(prefix = "l"): string {
  idCounter++;
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID().slice(0, 8)}_${idCounter}`;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Maximum canvas edge in v1 (PLAN.md). */
export const MAX_CANVAS_SIZE = 8192;

export interface CreateDocumentOptions {
  name?: string;
  width: number;
  height: number;
  /** `"transparent"` (default) leaves the background layer empty. */
  background?: "transparent" | "white" | RGBA;
  dpi?: number;
  /** Skip creating the initial "Background" layer. */
  noBackgroundLayer?: boolean;
}

/** Create a document with one background layer (unless `noBackgroundLayer`). */
export function createDocument(opts: CreateDocumentOptions): Document {
  const { width, height } = opts;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_CANVAS_SIZE ||
    height > MAX_CANVAS_SIZE
  ) {
    throw new RangeError(`createDocument: invalid size ${width}x${height} (max ${MAX_CANVAS_SIZE})`);
  }
  const now = Date.now();
  const meta: DocumentMeta = { dpi: opts.dpi ?? 72, createdAt: now, modifiedAt: now, path: null };
  const doc: Document = {
    id: newId("doc"),
    name: opts.name ?? "Untitled-1",
    width,
    height,
    layers: [],
    selection: Selection.none(width, height),
    activeLayerId: null,
    dirty: false,
    meta,
  };
  if (!opts.noBackgroundLayer) {
    const bg = createRasterLayer(doc, { name: "Background" });
    const fill = opts.background ?? "transparent";
    if (fill === "white") bg.raster.fill({ r: 255, g: 255, b: 255, a: 255 });
    else if (fill !== "transparent") bg.raster.fill(fill);
    doc.layers.push(bg);
    doc.activeLayerId = bg.id;
  }
  return doc;
}

export interface CreateLayerOptions {
  name?: string;
  /** Defaults to a transparent raster the size of the document. */
  raster?: Raster;
  offset?: Point;
  opacity?: number;
  blendMode?: BlendMode;
  visible?: boolean;
  locked?: boolean;
  parentId?: LayerId | null;
  id?: LayerId;
}

/** Build a raster layer object (not yet inserted into the document). */
export function createRasterLayer(doc: Document, opts: CreateLayerOptions = {}): RasterLayer {
  return {
    id: opts.id ?? newId("layer"),
    kind: "raster",
    name: opts.name ?? nextLayerName(doc),
    raster: opts.raster ?? new Raster(doc.width, doc.height),
    offset: opts.offset ? { x: opts.offset.x, y: opts.offset.y } : { x: 0, y: 0 },
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? BlendMode.Normal,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    parentId: opts.parentId ?? null,
    mask: null,
  };
}

/** Build a group layer object (not yet inserted). */
export function createGroupLayer(doc: Document, opts: Omit<CreateLayerOptions, "raster"> = {}): GroupLayer {
  return {
    id: opts.id ?? newId("group"),
    kind: "group",
    name: opts.name ?? `Group ${doc.layers.filter((l) => l.kind === "group").length + 1}`,
    raster: null,
    offset: { x: 0, y: 0 },
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? BlendMode.Normal,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    parentId: opts.parentId ?? null,
    mask: null,
    collapsed: false,
  };
}

/** `Layer 1`, `Layer 2`, ... skipping names already in use. */
export function nextLayerName(doc: Document, base = "Layer"): string {
  const used = new Set(doc.layers.map((l) => l.name));
  let n = doc.layers.length + 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findLayer(doc: Document, id: LayerId): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

/** Like `findLayer` but throws a descriptive error. */
export function getLayer(doc: Document, id: LayerId): Layer {
  const l = findLayer(doc, id);
  if (!l) throw new Error(`Layer not found: ${id}`);
  return l;
}

/** Narrowing helper for raster layers; throws for groups/missing. */
export function getRasterLayer(doc: Document, id: LayerId): RasterLayer {
  const l = getLayer(doc, id);
  if (l.kind !== "raster") throw new Error(`Layer ${id} is a group`);
  return l;
}

export function layerIndex(doc: Document, id: LayerId): number {
  return doc.layers.findIndex((l) => l.id === id);
}

/** The active layer, if any. */
export function activeLayer(doc: Document): Layer | undefined {
  return doc.activeLayerId ? findLayer(doc, doc.activeLayerId) : undefined;
}

/** Direct children of a group, bottom to top. */
export function childrenOf(doc: Document, groupId: LayerId): Layer[] {
  return doc.layers.filter((l) => l.parentId === groupId);
}

/** Layers with no parent, bottom to top. */
export function topLevelLayers(doc: Document): Layer[] {
  return doc.layers.filter((l) => l.parentId === null);
}

/** The layer's rect in document space. Groups cover the whole document. */
export function layerDocRect(doc: Document, layer: Layer): Rect {
  if (layer.kind === "group") return Rect.ofSize(doc.width, doc.height);
  return Rect.make(layer.offset.x, layer.offset.y, layer.raster.width, layer.raster.height);
}

/** Indices `[start, end)` of the contiguous block for a layer (a group plus its children). */
export function layerBlock(doc: Document, id: LayerId): { start: number; end: number } {
  const start = layerIndex(doc, id);
  if (start < 0) throw new Error(`Layer not found: ${id}`);
  const layer = doc.layers[start]!;
  let end = start + 1;
  if (layer.kind === "group") {
    while (end < doc.layers.length && doc.layers[end]!.parentId === id) end++;
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// Mutations (no history)
// ---------------------------------------------------------------------------

function touch(doc: Document): void {
  doc.dirty = true;
  doc.meta.modifiedAt = Date.now();
}

/**
 * Insert a layer at `index` (bottom-to-top position; default: directly above the active
 * layer, or on top). A group's children must be inserted separately, after the group.
 */
export function addLayer(doc: Document, layer: Layer, index?: number): number {
  let at: number;
  if (index === undefined) {
    const active = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) : -1;
    if (active >= 0) {
      const block = layerBlock(doc, doc.activeLayerId as LayerId);
      at = block.end;
      const activeLayerObj = doc.layers[active]!;
      // Inserting above a child keeps it in the same group.
      if (layer.parentId === null && activeLayerObj.parentId !== null && activeLayerObj.kind === "raster") {
        layer.parentId = activeLayerObj.parentId;
      }
    } else {
      at = doc.layers.length;
    }
  } else {
    at = Math.max(0, Math.min(doc.layers.length, index));
  }
  doc.layers.splice(at, 0, layer);
  doc.activeLayerId = layer.id;
  touch(doc);
  return at;
}

/** Remove a layer (and, for a group, its children). Returns the removed block. */
export function removeLayer(doc: Document, id: LayerId): { index: number; layers: Layer[] } {
  const { start, end } = layerBlock(doc, id);
  const removed = doc.layers.splice(start, end - start);
  if (doc.activeLayerId && removed.some((l) => l.id === doc.activeLayerId)) {
    const next = doc.layers[Math.min(start, doc.layers.length - 1)];
    doc.activeLayerId = next ? next.id : null;
  }
  touch(doc);
  return { index: start, layers: removed };
}

/** Deep-copy a layer (new id, " copy" suffix). Groups copy their children too. */
export function duplicateLayer(doc: Document, id: LayerId): Layer[] {
  const { start, end } = layerBlock(doc, id);
  const src = doc.layers.slice(start, end);
  const idMap = new Map<LayerId, LayerId>();
  const copies: Layer[] = src.map((l) => {
    const nid = newId(l.kind === "group" ? "group" : "layer");
    idMap.set(l.id, nid);
    const base = {
      id: nid,
      name: l.id === id ? `${l.name} copy` : l.name,
      offset: { x: l.offset.x, y: l.offset.y },
      opacity: l.opacity,
      blendMode: l.blendMode,
      visible: l.visible,
      locked: l.locked,
      parentId: l.parentId,
      mask: l.mask ? l.mask.clone() : null,
    };
    if (l.kind === "group") {
      return { ...base, kind: "group", raster: null, collapsed: l.collapsed } satisfies GroupLayer;
    }
    return { ...base, kind: "raster", raster: l.raster.clone() } satisfies RasterLayer;
  });
  for (const c of copies) if (c.parentId && idMap.has(c.parentId)) c.parentId = idMap.get(c.parentId)!;
  doc.layers.splice(end, 0, ...copies);
  doc.activeLayerId = copies[0]!.id;
  touch(doc);
  return copies;
}

/**
 * Move a layer block so that it starts at `toIndex` (index in the array *after* removal).
 * Returns the index it ended up at.
 */
export function moveLayer(doc: Document, id: LayerId, toIndex: number): number {
  const { start, end } = layerBlock(doc, id);
  const block = doc.layers.splice(start, end - start);
  const at = Math.max(0, Math.min(doc.layers.length, toIndex));
  doc.layers.splice(at, 0, ...block);
  touch(doc);
  return at;
}

export function renameLayer(doc: Document, id: LayerId, name: string): void {
  getLayer(doc, id).name = name;
  touch(doc);
}

/** Apply a partial set of props; returns the previous values of the keys that changed. */
export function setLayerProps(doc: Document, id: LayerId, props: Partial<LayerProps>): Partial<LayerProps> {
  const layer = getLayer(doc, id);
  const prev: Partial<LayerProps> = {};
  if (props.name !== undefined && props.name !== layer.name) {
    prev.name = layer.name;
    layer.name = props.name;
  }
  if (props.offset !== undefined && (props.offset.x !== layer.offset.x || props.offset.y !== layer.offset.y)) {
    prev.offset = { ...layer.offset };
    layer.offset = { x: props.offset.x, y: props.offset.y };
  }
  if (props.opacity !== undefined && props.opacity !== layer.opacity) {
    prev.opacity = layer.opacity;
    layer.opacity = Math.max(0, Math.min(1, props.opacity));
  }
  if (props.blendMode !== undefined && props.blendMode !== layer.blendMode) {
    prev.blendMode = layer.blendMode;
    layer.blendMode = props.blendMode;
  }
  if (props.visible !== undefined && props.visible !== layer.visible) {
    prev.visible = layer.visible;
    layer.visible = props.visible;
  }
  if (props.locked !== undefined && props.locked !== layer.locked) {
    prev.locked = layer.locked;
    layer.locked = props.locked;
  }
  if (props.collapsed !== undefined && layer.kind === "group" && props.collapsed !== layer.collapsed) {
    prev.collapsed = layer.collapsed;
    layer.collapsed = props.collapsed;
  }
  touch(doc);
  return prev;
}

/**
 * Composite a set of layers (bottom to top, each with its own blend/opacity) into a new
 * document-sized raster. Used by merge/flatten and by group compositing.
 */
export function compositeLayers(doc: Document, layers: readonly Layer[], rect?: Rect): Raster {
  const out = new Raster(doc.width, doc.height);
  compositeInto(doc, layers, out, rect ?? Rect.ofSize(doc.width, doc.height));
  return out;
}

/**
 * Merge a layer into the one directly below it (same parent). The result keeps the
 * lower layer's id/name/props and becomes a full-document raster at offset 0,0.
 */
export function mergeDown(doc: Document, id: LayerId): RasterLayer {
  const idx = layerIndex(doc, id);
  if (idx <= 0) throw new Error("mergeDown: nothing below");
  const upper = doc.layers[idx]!;
  // Walk down to the previous sibling (skip other groups' children).
  let j = idx - 1;
  while (j >= 0 && doc.layers[j]!.parentId !== upper.parentId) j--;
  if (j < 0) throw new Error("mergeDown: nothing below");
  const lower = doc.layers[j]!;
  if (lower.kind !== "raster") throw new Error("mergeDown: layer below is a group");
  const upperBlock = upper.kind === "group" ? doc.layers.slice(idx, layerBlock(doc, id).end) : [upper];
  const merged = compositeLayers(doc, [
    { ...lower, opacity: 1, blendMode: BlendMode.Normal, visible: true },
    ...upperBlock,
  ]);
  lower.raster = merged;
  lower.offset = { x: 0, y: 0 };
  lower.mask = null;
  doc.layers.splice(idx, upperBlock.length);
  doc.activeLayerId = lower.id;
  touch(doc);
  return lower;
}

/** Merge every visible layer into the lowest visible raster layer; hidden layers remain. */
export function mergeVisible(doc: Document): RasterLayer | null {
  const visible = doc.layers.filter((l) => isEffectivelyVisible(doc, l));
  const target = visible.find((l): l is RasterLayer => l.kind === "raster");
  if (!target) return null;
  const merged = compositeLayers(doc, topLevelLayers(doc).filter((l) => l.visible));
  target.raster = merged;
  target.offset = { x: 0, y: 0 };
  target.mask = null;
  target.opacity = 1;
  target.blendMode = BlendMode.Normal;
  target.parentId = null;
  doc.layers = doc.layers.filter((l) => l === target || !isEffectivelyVisible(doc, l));
  doc.activeLayerId = target.id;
  touch(doc);
  return target;
}

/** Collapse the whole document to one opaque "Background" layer (transparent areas stay transparent). */
export function flatten(doc: Document): RasterLayer {
  const merged = compositeToRaster(doc);
  const bg = createRasterLayer(doc, { name: "Background", raster: merged });
  doc.layers = [bg];
  doc.activeLayerId = bg.id;
  touch(doc);
  return bg;
}

/** Wrap the given top-level layers in a new group inserted at the position of the lowest one. */
export function groupLayers(doc: Document, ids: readonly LayerId[], name?: string): GroupLayer {
  const members = doc.layers.filter((l) => ids.includes(l.id));
  if (members.length === 0) throw new Error("groupLayers: no layers");
  if (members.some((l) => l.kind === "group" || l.parentId !== null)) {
    throw new Error("groupLayers: only top-level raster layers can be grouped (v1: one level)");
  }
  const lowest = Math.min(...members.map((l) => layerIndex(doc, l.id)));
  const group = createGroupLayer(doc, name ? { name } : {});
  doc.layers = doc.layers.filter((l) => !members.includes(l));
  for (const m of members) m.parentId = group.id;
  const at = Math.min(lowest, doc.layers.length);
  doc.layers.splice(at, 0, group, ...members);
  doc.activeLayerId = group.id;
  touch(doc);
  return group;
}

/** Dissolve a group, moving its children to top level in place. */
export function ungroupLayers(doc: Document, groupId: LayerId): Layer[] {
  const { start, end } = layerBlock(doc, groupId);
  const children = doc.layers.slice(start + 1, end);
  for (const c of children) c.parentId = null;
  doc.layers.splice(start, 1);
  doc.activeLayerId = children[0]?.id ?? null;
  touch(doc);
  return children;
}

/** Visible, and (for children) inside a visible group. */
export function isEffectivelyVisible(doc: Document, layer: Layer): boolean {
  if (!layer.visible) return false;
  if (layer.parentId) {
    const parent = findLayer(doc, layer.parentId);
    return parent ? parent.visible : true;
  }
  return true;
}

// ---------------------------------------------------------------------------
// CPU compositor
// ---------------------------------------------------------------------------

export interface CompositeOptions {
  /** Only composite this document-space rect (output is still document-sized). */
  rect?: Rect;
  /** Reuse an existing document-sized raster as the output (cleared inside `rect`). */
  into?: Raster;
  /** Ignore `visible` flags. Default false. */
  ignoreVisibility?: boolean;
  /** Composite only these layer ids (top-level entries; groups bring their children). */
  layerIds?: readonly LayerId[];
}

const px = new Float32Array(4);

/**
 * Composite one source raster onto `dst` (both document-sized, straight alpha) inside
 * `rect`, honouring the source's offset, opacity, blend mode and optional mask.
 */
function blendRasterInto(
  dst: Raster,
  src: Raster,
  offset: Point,
  opacity: number,
  mode: BlendMode,
  mask: Raster | null,
  rect: Rect,
): void {
  const area = Rect.intersect(rect, Rect.make(offset.x, offset.y, src.width, src.height));
  if (Rect.isEmpty(area) || opacity <= 0) return;
  const d = dst.data;
  const s = src.data;
  const m = mask ? mask.data : null;
  const dw = dst.width;
  const sw = src.width;
  const inv = 1 / 255;
  for (let y = area.y; y < area.y + area.h; y++) {
    let di = (y * dw + area.x) * 4;
    let si = ((y - offset.y) * sw + (area.x - offset.x)) * 4;
    for (let x = 0; x < area.w; x++, di += 4, si += 4) {
      let as = s[si + 3]! * inv * opacity;
      if (m) as *= m[si]! * inv;
      if (as <= 0) continue;
      const ab = d[di + 3]! * inv;
      if (mode === BlendMode.Normal) {
        // Fast path: plain straight-alpha "over".
        const ao = as + ab * (1 - as);
        const wd = (ab * (1 - as)) / ao;
        const ws = as / ao;
        d[di] = s[si]! * ws + d[di]! * wd;
        d[di + 1] = s[si + 1]! * ws + d[di + 1]! * wd;
        d[di + 2] = s[si + 2]! * ws + d[di + 2]! * wd;
        d[di + 3] = ao * 255;
        continue;
      }
      compositeStraight(
        mode,
        d[di]! * inv,
        d[di + 1]! * inv,
        d[di + 2]! * inv,
        ab,
        s[si]! * inv,
        s[si + 1]! * inv,
        s[si + 2]! * inv,
        as,
        px,
      );
      d[di] = px[0]! * 255;
      d[di + 1] = px[1]! * 255;
      d[di + 2] = px[2]! * 255;
      d[di + 3] = px[3]! * 255;
    }
  }
}

function compositeInto(doc: Document, layers: readonly Layer[], out: Raster, rect: Rect, ignoreVisibility = false): void {
  const area = Rect.intersect(rect, Rect.ofSize(doc.width, doc.height));
  if (Rect.isEmpty(area)) return;
  out.clear(area);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!ignoreVisibility && !layer.visible) continue;
    if (layer.kind === "raster") {
      blendRasterInto(out, layer.raster, layer.offset, layer.opacity, layer.blendMode, layer.mask, area);
      continue;
    }
    // Group: composite children in isolation, then blend the result as one layer.
    const children = childrenOf(doc, layer.id);
    if (children.length === 0) continue;
    const tmp = new Raster(doc.width, doc.height);
    compositeInto(doc, children, tmp, area, ignoreVisibility);
    blendRasterInto(out, tmp, { x: 0, y: 0 }, layer.opacity, layer.blendMode, layer.mask, area);
  }
}

/**
 * Reference CPU composite of the document (straight alpha RGBA8, document size). Used
 * for exports, AI inputs, merges and tests. The WebGL2 compositor implements the same
 * math on the GPU.
 */
export function compositeToRaster(doc: Document, opts: CompositeOptions = {}): Raster {
  const out = opts.into ?? new Raster(doc.width, doc.height);
  if (out.width !== doc.width || out.height !== doc.height) {
    throw new RangeError("compositeToRaster: `into` must be document-sized");
  }
  const rect = opts.rect ?? Rect.ofSize(doc.width, doc.height);
  let layers = topLevelLayers(doc);
  if (opts.layerIds) layers = layers.filter((l) => opts.layerIds!.includes(l.id));
  compositeInto(doc, layers, out, rect, opts.ignoreVisibility ?? false);
  return out;
}

/** Composite restricted to the selection's bounding box (used for AI mask edits). */
export function compositeSelectionBbox(doc: Document, padding = 0): { raster: Raster; rect: Rect } | null {
  const bb = doc.selection.bbox;
  if (!bb) return null;
  const rect = Rect.intersect(Rect.inflate(bb, padding), Rect.ofSize(doc.width, doc.height));
  const full = compositeToRaster(doc, { rect });
  return { raster: full.crop(rect), rect };
}

/** Total bytes held by layer rasters and masks (for status bars and budgets). */
export function documentByteSize(doc: Document): number {
  let n = doc.selection.byteLength();
  for (const l of doc.layers) {
    if (l.kind === "raster") n += l.raster.byteLength();
    if (l.mask) n += l.mask.byteLength();
  }
  return n;
}
