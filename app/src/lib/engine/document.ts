/**
 * Document / Layer model and the reference **CPU compositor**.
 *
 * The document is a plain mutable object (see `types.ts`). The functions here are the
 * primitive layer operations that commands build on; they do not record history and
 * they do not notify anyone. Use the commands in `commands/` from UI code.
 *
 * Compositing semantics (PLAN-v2 §1, Photoshop):
 * 1. source pixels (raster / cached raster for shape & text / fill render / the
 *    composite below for adjustment layers)
 * 2. layer mask (red channel, when `maskEnabled`) multiplies the source alpha
 * 3. layer effects in PS order (inner effects over the fill at `fillOpacity`, drop
 *    shadow / outer glow beneath, stroke / overlays on top) — `ops/effects.ts`
 * 4. clipping: the base plus its chain of `clipToBelow` layers composite as one unit
 *    (children multiplied by the base's content alpha), then the unit blends with the
 *    base's blend mode and opacity
 * 5. blend at `opacity` with `blendMode`
 * Groups: `passThrough` (default) composites the children straight onto the backdrop
 * (with the group's opacity / mask as a lerp); isolated groups composite the children
 * into a transparent buffer first and blend the result with the group's mode.
 */

import { Rect, type Point } from "./rect";
import { Raster } from "./raster";
import { Selection } from "./selection";
import { blendRgb, compositeStraight } from "./blend";
import {
  BlendMode,
  type AdjustmentLayer,
  type AlphaChannel,
  type Document,
  type DocumentMeta,
  type FillLayer,
  type FillRule,
  type FillSpec,
  type GradientFill,
  type GroupLayer,
  type Layer,
  type LayerBase,
  type LayerColor,
  type LayerEffects,
  type LayerId,
  type LayerLock,
  type LayerProps,
  type Path,
  type PixelLayer,
  type QuickMask,
  type RasterLayer,
  type RGBA,
  type ShapeLayer,
  type SolidFill,
  type StrokeSpec,
  type TextLayer,
  type TextSpec,
} from "./types";
import type { ParamValues } from "./ops/types";
import { opById } from "./ops/registry";
import { cloneEffects } from "./ops/effects";
import { cloneFill } from "./ops/fill";
import { clonePath, pathCoverage, strokePathCoverage, coverageToRaster } from "./ops/vector";
import { rasterizeText } from "./ops/text";
import { StyleCache, docStyleCache, fillLayerRaster, layerSource, maskActive } from "./layer-source";

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

/** PS quick-mask defaults: red at 50 %, color indicates masked areas. */
export function defaultQuickMask(): QuickMask {
  return { active: false, raster: null, color: { r: 255, g: 0, b: 0, a: 255 }, opacity: 0.5, maskedAreas: true };
}

export function defaultLock(): LayerLock {
  return { transparent: false, pixels: false, position: false, all: false };
}

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
    alphaChannels: [],
    quickMask: defaultQuickMask(),
    paths: [],
    workPathId: null,
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
  mask?: Raster | null;
  maskEnabled?: boolean;
  maskLinked?: boolean;
  clipToBelow?: boolean;
  fillOpacity?: number;
  lock?: Partial<LayerLock>;
  effects?: LayerEffects | null;
  linkedTo?: LayerId[];
  color?: LayerColor | null;
}

/** The `LayerBase` part shared by every factory. */
function baseFields(id: LayerId, kind: Layer["kind"], name: string, opts: CreateLayerOptions): Omit<LayerBase, "kind"> & { kind: Layer["kind"] } {
  return {
    id,
    kind,
    name,
    offset: opts.offset ? { x: opts.offset.x, y: opts.offset.y } : { x: 0, y: 0 },
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? BlendMode.Normal,
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    parentId: opts.parentId ?? null,
    mask: opts.mask ?? null,
    maskEnabled: opts.maskEnabled ?? true,
    maskLinked: opts.maskLinked ?? true,
    clipToBelow: opts.clipToBelow ?? false,
    fillOpacity: opts.fillOpacity ?? 1,
    lock: { ...defaultLock(), ...(opts.lock ?? {}), ...(opts.locked ? { all: true } : {}) },
    effects: opts.effects ?? null,
    linkedTo: opts.linkedTo ? opts.linkedTo.slice() : [],
    color: opts.color ?? null,
  };
}

/** Build a raster layer object (not yet inserted into the document). */
export function createRasterLayer(doc: Document, opts: CreateLayerOptions = {}): RasterLayer {
  return {
    ...baseFields(opts.id ?? newId("layer"), "raster", opts.name ?? nextLayerName(doc), opts),
    kind: "raster",
    raster: opts.raster ?? new Raster(doc.width, doc.height),
  };
}

export interface CreateGroupOptions extends Omit<CreateLayerOptions, "raster"> {
  /** PS "Pass Through" (default true). */
  passThrough?: boolean;
  collapsed?: boolean;
}

/** Build a group layer object (not yet inserted). */
export function createGroupLayer(doc: Document, opts: CreateGroupOptions = {}): GroupLayer {
  return {
    ...baseFields(opts.id ?? newId("group"), "group", opts.name ?? `Group ${doc.layers.filter((l) => l.kind === "group").length + 1}`, { ...opts, offset: { x: 0, y: 0 } }),
    kind: "group",
    raster: null,
    collapsed: opts.collapsed ?? false,
    passThrough: opts.passThrough ?? true,
  };
}

export interface CreateAdjustmentOptions extends Omit<CreateLayerOptions, "raster"> {
  /** Op id from `ops/registry` (e.g. `"levels"`). */
  op: string;
  params?: ParamValues;
}

/** Build an adjustment layer (not yet inserted). Unknown op ids are accepted (render as no-op). */
export function createAdjustmentLayer(doc: Document, opts: CreateAdjustmentOptions): AdjustmentLayer {
  void doc;
  const def = opById(opts.op);
  const params: ParamValues = {};
  if (def) for (const p of def.params) params[p.id] = Array.isArray(p.default) ? p.default.slice() : p.default;
  if (def?.groupSelector) params[def.groupSelector.id] = def.groupSelector.default;
  Object.assign(params, opts.params ?? {});
  return {
    ...baseFields(opts.id ?? newId("adj"), "adjustment", opts.name ?? (def?.label ?? opts.op), { ...opts, offset: { x: 0, y: 0 } }),
    kind: "adjustment",
    raster: null,
    op: opts.op,
    params,
  };
}

export interface CreateFillOptions extends Omit<CreateLayerOptions, "raster"> {
  fill: FillSpec;
}

/** Build a fill layer (not yet inserted). */
export function createFillLayer(doc: Document, opts: CreateFillOptions): FillLayer {
  const label = opts.fill.type === "solid" ? "Color Fill" : opts.fill.type === "gradient" ? "Gradient Fill" : "Pattern Fill";
  return {
    ...baseFields(opts.id ?? newId("fill"), "fill", opts.name ?? nextLayerName(doc, label), { ...opts, offset: opts.offset ?? { x: 0, y: 0 } }),
    kind: "fill",
    raster: null,
    fill: opts.fill,
  };
}

export interface CreateShapeOptions extends Omit<CreateLayerOptions, "raster"> {
  path: Path;
  fill?: SolidFill | GradientFill | null;
  stroke?: StrokeSpec | null;
  fillRule?: FillRule;
}

/** Build a shape layer (not yet inserted); rasterizes immediately. */
export function createShapeLayer(doc: Document, opts: CreateShapeOptions): ShapeLayer {
  const layer: ShapeLayer = {
    ...baseFields(opts.id ?? newId("shape"), "shape", opts.name ?? nextLayerName(doc, "Shape"), opts),
    kind: "shape",
    raster: new Raster(doc.width, doc.height),
    path: opts.path,
    fill: opts.fill === undefined ? { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } } : opts.fill,
    stroke: opts.stroke ?? null,
    fillRule: opts.fillRule ?? "nonzero",
  };
  rerasterizeShape(doc, layer);
  return layer;
}

export interface CreateTextOptions extends Omit<CreateLayerOptions, "raster"> {
  text: TextSpec;
}

/** Build a text layer (not yet inserted); rasterizes immediately. */
export function createTextLayer(doc: Document, opts: CreateTextOptions): TextLayer {
  const name = opts.name ?? (opts.text.text.split("\n")[0]?.slice(0, 40) || "Type");
  const layer: TextLayer = {
    ...baseFields(opts.id ?? newId("text"), "text", name, opts),
    kind: "text",
    raster: new Raster(doc.width, doc.height),
    text: opts.text,
  };
  rerasterizeText(doc, layer);
  return layer;
}

/**
 * Rasterize a shape layer's path / fill / stroke into a new document-sized raster
 * (assigned to `layer.raster`, so compositors detect the swap). Call after editing
 * `path`, `fill` or `stroke`.
 */
export function rerasterizeShape(doc: Document, layer: ShapeLayer): Raster {
  const w = doc.width;
  const h = doc.height;
  const fillCov = pathCoverage(layer.path, w, h, { rule: layer.fillRule, aa: true });
  let out = layer.fill ? coverageToRaster(fillCov, w, h, layer.fill) : new Raster(w, h);
  const st = layer.stroke;
  if (st && st.width > 0) {
    const width = st.position === "center" ? st.width : st.width * 2;
    const cov = strokePathCoverage(layer.path, width, w, h, { cap: st.cap, join: st.join, dash: st.dash, aa: true });
    if (st.position === "inside") for (let i = 0; i < cov.length; i++) cov[i] = (cov[i]! * fillCov[i]!) / 255;
    else if (st.position === "outside") for (let i = 0; i < cov.length; i++) cov[i] = (cov[i]! * (255 - fillCov[i]!)) / 255;
    const strokeRaster = coverageToRaster(cov, w, h, st.fill);
    if (!layer.fill) out = strokeRaster;
    else out.blit(strokeRaster, 0, 0);
  }
  layer.raster = out;
  return out;
}

/** Re-render a text layer's `TextSpec` into a new document-sized raster (assigned to `layer.raster`). */
export function rerasterizeText(doc: Document, layer: TextLayer): Raster {
  layer.raster = rasterizeText(layer.text, doc.width, doc.height);
  return layer.raster;
}

/** `Layer 1`, `Layer 2`, ... skipping names already in use. */
export function nextLayerName(doc: Document, base = "Layer"): string {
  const used = new Set(doc.layers.map((l) => l.name));
  let n = doc.layers.filter((l) => l.name.startsWith(base)).length + 1;
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

/** Narrowing helper for raster layers; throws for other kinds / missing. */
export function getRasterLayer(doc: Document, id: LayerId): RasterLayer {
  const l = getLayer(doc, id);
  if (l.kind !== "raster") throw new Error(`Layer ${id} is a ${l.kind}, not a raster layer`);
  return l;
}

/** True for raster / shape / text layers (they carry a `Raster`). */
export function isPixelLayer(layer: Layer): layer is PixelLayer {
  return layer.kind === "raster" || layer.kind === "shape" || layer.kind === "text";
}

/** Narrowing helper for any layer with a raster (raster / shape / text); throws otherwise. */
export function getPixelLayer(doc: Document, id: LayerId): PixelLayer {
  const l = getLayer(doc, id);
  if (!isPixelLayer(l)) throw new Error(`Layer ${id} is a ${l.kind} and has no pixels`);
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

/** Siblings of a layer (same parent), bottom to top. */
export function siblingsOf(doc: Document, layer: Layer): Layer[] {
  return doc.layers.filter((l) => l.parentId === layer.parentId);
}

/** The layer's rect in document space. Groups / adjustments / fills cover the whole document. */
export function layerDocRect(doc: Document, layer: Layer): Rect {
  if (isPixelLayer(layer)) return Rect.make(layer.offset.x, layer.offset.y, layer.raster.width, layer.raster.height);
  return Rect.ofSize(doc.width, doc.height);
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

/**
 * The clipping base of a layer: the nearest sibling below that is not itself clipped,
 * or null when the layer is not clipped (or has nothing below it).
 */
export function clipBaseOf(doc: Document, id: LayerId): Layer | null {
  const layer = getLayer(doc, id);
  if (!layer.clipToBelow || layer.kind === "group") return null;
  const sibs = siblingsOf(doc, layer);
  let i = sibs.findIndex((l) => l.id === id) - 1;
  while (i >= 0) {
    const l = sibs[i]!;
    if (!l.clipToBelow || l.kind === "group") return l.kind === "group" ? null : l;
    i--;
  }
  return null;
}

/** Layers clipped to `baseId` (the contiguous run of `clipToBelow` siblings above it), bottom to top. */
export function clippedLayersOf(doc: Document, baseId: LayerId): Layer[] {
  const base = getLayer(doc, baseId);
  const sibs = siblingsOf(doc, base);
  const out: Layer[] = [];
  for (let i = sibs.findIndex((l) => l.id === baseId) + 1; i < sibs.length; i++) {
    const l = sibs[i]!;
    if (!l.clipToBelow || l.kind === "group") break;
    out.push(l);
  }
  return out;
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
      if (layer.parentId === null && activeLayerObj.parentId !== null && activeLayerObj.kind !== "group") {
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
  const ids = new Set(removed.map((l) => l.id));
  for (const l of doc.layers) if (l.linkedTo.length) l.linkedTo = l.linkedTo.filter((x) => !ids.has(x));
  if (doc.activeLayerId && ids.has(doc.activeLayerId)) {
    const next = doc.layers[Math.min(start, doc.layers.length - 1)];
    doc.activeLayerId = next ? next.id : null;
  }
  touch(doc);
  return { index: start, layers: removed };
}

/** The `LayerBase` fields of a layer, deep-copied (mask cloned, effects/lock copied). */
export function layerBaseOf(layer: Layer, over: { id?: LayerId; name?: string } = {}): LayerBase {
  return {
    id: over.id ?? layer.id,
    kind: layer.kind,
    name: over.name ?? layer.name,
    offset: { x: layer.offset.x, y: layer.offset.y },
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    visible: layer.visible,
    locked: layer.locked,
    parentId: layer.parentId,
    mask: layer.mask ? layer.mask.clone() : null,
    maskEnabled: layer.maskEnabled,
    maskLinked: layer.maskLinked,
    clipToBelow: layer.clipToBelow,
    fillOpacity: layer.fillOpacity,
    lock: { ...layer.lock },
    effects: cloneEffects(layer.effects),
    linkedTo: layer.linkedTo.slice(),
    color: layer.color,
  };
}

/** Deep copy of a single layer object with a new id (children of groups are not copied). */
export function cloneLayer(layer: Layer, newLayerId?: LayerId, name?: string): Layer {
  const base = { ...layerBaseOf(layer, { id: newLayerId ?? newId(layer.kind === "group" ? "group" : "layer"), name: name ?? layer.name }), linkedTo: [] as LayerId[] };
  switch (layer.kind) {
    case "group":
      return { ...base, kind: "group", raster: null, collapsed: layer.collapsed, passThrough: layer.passThrough };
    case "raster":
      return { ...base, kind: "raster", raster: layer.raster.clone() };
    case "adjustment":
      return { ...base, kind: "adjustment", raster: null, op: layer.op, params: JSON.parse(JSON.stringify(layer.params)) as ParamValues };
    case "fill":
      return { ...base, kind: "fill", raster: null, fill: cloneFill(layer.fill) };
    case "shape":
      return {
        ...base,
        kind: "shape",
        raster: layer.raster.clone(),
        path: clonePath(layer.path),
        fill: layer.fill ? cloneFill(layer.fill) : null,
        stroke: layer.stroke ? { ...layer.stroke, fill: cloneFill(layer.stroke.fill), dash: layer.stroke.dash ? layer.stroke.dash.slice() : null } : null,
        fillRule: layer.fillRule,
      };
    case "text":
      return { ...base, kind: "text", raster: layer.raster.clone(), text: { ...layer.text, color: { ...layer.text.color } } };
  }
}

/** Deep-copy a layer (new id, " copy" suffix). Groups copy their children too. */
export function duplicateLayer(doc: Document, id: LayerId): Layer[] {
  const { start, end } = layerBlock(doc, id);
  const src = doc.layers.slice(start, end);
  const idMap = new Map<LayerId, LayerId>();
  const copies: Layer[] = src.map((l) => {
    const nid = newId(l.kind === "group" ? "group" : "layer");
    idMap.set(l.id, nid);
    return cloneLayer(l, nid, l.id === id ? `${l.name} copy` : l.name);
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
  if (props.fillOpacity !== undefined && props.fillOpacity !== layer.fillOpacity) {
    prev.fillOpacity = layer.fillOpacity;
    layer.fillOpacity = Math.max(0, Math.min(1, props.fillOpacity));
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
    layer.lock = { ...layer.lock, all: props.locked };
  }
  if (props.collapsed !== undefined && layer.kind === "group" && props.collapsed !== layer.collapsed) {
    prev.collapsed = layer.collapsed;
    layer.collapsed = props.collapsed;
  }
  if (props.passThrough !== undefined && layer.kind === "group" && props.passThrough !== layer.passThrough) {
    prev.passThrough = layer.passThrough;
    layer.passThrough = props.passThrough;
  }
  if (props.maskEnabled !== undefined && props.maskEnabled !== layer.maskEnabled) {
    prev.maskEnabled = layer.maskEnabled;
    layer.maskEnabled = props.maskEnabled;
  }
  if (props.maskLinked !== undefined && props.maskLinked !== layer.maskLinked) {
    prev.maskLinked = layer.maskLinked;
    layer.maskLinked = props.maskLinked;
  }
  if (props.clipToBelow !== undefined && props.clipToBelow !== layer.clipToBelow) {
    prev.clipToBelow = layer.clipToBelow;
    layer.clipToBelow = props.clipToBelow;
  }
  if (props.color !== undefined && props.color !== layer.color) {
    prev.color = layer.color;
    layer.color = props.color;
  }
  touch(doc);
  return prev;
}

/**
 * Composite a set of sibling layers (bottom to top, each with its own blend/opacity)
 * into a new document-sized raster. Used by merge/flatten and by group compositing.
 */
export function compositeLayers(doc: Document, layers: readonly Layer[], rect?: Rect, cache?: StyleCache): Raster {
  const out = new Raster(doc.width, doc.height);
  compositeSiblings(doc, layers, out, rect ?? Rect.ofSize(doc.width, doc.height), { ignoreVisibility: false, cache: cache ?? docStyleCache(doc) ?? new StyleCache() });
  return out;
}

/** Replace a layer object in place (same index) — used when a layer changes kind. */
function replaceLayerObject(doc: Document, id: LayerId, next: Layer): void {
  const i = layerIndex(doc, id);
  if (i < 0) throw new Error(`Layer not found: ${id}`);
  doc.layers[i] = next;
}

/**
 * Convert a shape / text / fill layer into a plain raster layer with the same id and
 * properties (Layer ▸ Rasterize). Raster layers are returned unchanged; groups and
 * adjustment layers throw.
 */
export function rasterizeLayer(doc: Document, id: LayerId): RasterLayer {
  const l = getLayer(doc, id);
  if (l.kind === "raster") return l;
  if (l.kind === "group" || l.kind === "adjustment") throw new Error(`Cannot rasterize a ${l.kind} layer`);
  const src = layerSource(doc, l)!;
  const next: RasterLayer = { ...layerBaseOf(l), kind: "raster", raster: src.raster.clone() };
  replaceLayerObject(doc, id, next);
  touch(doc);
  return next;
}

/**
 * Merge a layer into the one directly below it (same parent). The result keeps the
 * lower layer's id/name/props and becomes a full-document raster at offset 0,0. Clipped
 * layers merge into their base, effects are baked in, masks are applied. Shape / text /
 * fill layers below are rasterized first.
 */
export function mergeDown(doc: Document, id: LayerId): RasterLayer {
  const idx = layerIndex(doc, id);
  if (idx <= 0) throw new Error("mergeDown: nothing below");
  const upper = doc.layers[idx]!;
  // Walk down to the previous sibling (skip other groups' children).
  let j = idx - 1;
  while (j >= 0 && doc.layers[j]!.parentId !== upper.parentId) j--;
  if (j < 0) throw new Error("mergeDown: nothing below");
  const below = doc.layers[j]!;
  if (below.kind === "group" || below.kind === "adjustment") throw new Error(`mergeDown: layer below is a ${below.kind}`);
  const lower = rasterizeLayer(doc, below.id);
  const upperBlock = upper.kind === "group" ? doc.layers.slice(idx, layerBlock(doc, id).end) : [upper];
  // Composite the pair with the lower at full opacity / Normal (its own mask, effects and
  // fill opacity are baked in; a clipped upper stays clipped to the lower's content).
  const merged = compositeLayers(doc, [{ ...lower, opacity: 1, blendMode: BlendMode.Normal, visible: true }, ...upperBlock]);
  lower.raster = merged;
  lower.offset = { x: 0, y: 0 };
  lower.mask = null;
  lower.effects = null;
  lower.fillOpacity = 1;
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
  target.effects = null;
  target.fillOpacity = 1;
  target.clipToBelow = false;
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
    throw new Error("groupLayers: only top-level layers can be grouped (one nesting level)");
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

/** Visible, and (for children) inside a visible group, and (for clipped layers) under a visible base. */
export function isEffectivelyVisible(doc: Document, layer: Layer): boolean {
  if (!layer.visible) return false;
  if (layer.parentId) {
    const parent = findLayer(doc, layer.parentId);
    if (parent && !parent.visible) return false;
  }
  if (layer.clipToBelow) {
    const base = clipBaseOf(doc, layer.id);
    if (base && !base.visible) return false;
  }
  return true;
}

/** Add an alpha channel object to the document (no history). */
export function addAlphaChannel(doc: Document, channel: AlphaChannel, index?: number): number {
  const at = index === undefined ? doc.alphaChannels.length : Math.max(0, Math.min(doc.alphaChannels.length, index));
  doc.alphaChannels.splice(at, 0, channel);
  touch(doc);
  return at;
}

export function removeAlphaChannel(doc: Document, id: string): { index: number; channel: AlphaChannel } | null {
  const i = doc.alphaChannels.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const [channel] = doc.alphaChannels.splice(i, 1);
  touch(doc);
  return { index: i, channel: channel! };
}

export function findAlphaChannel(doc: Document, id: string): AlphaChannel | undefined {
  return doc.alphaChannels.find((c) => c.id === id);
}

export function findPath(doc: Document, id: string): Path | undefined {
  return doc.paths.find((p) => p.id === id);
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
  /** Style cache to reuse (compositors pass theirs; defaults to a throwaway). */
  cache?: StyleCache;
}

interface Ctx {
  ignoreVisibility: boolean;
  cache: StyleCache;
}

const px = new Float32Array(4);
const rgbTmp = new Float32Array(3);

/**
 * Composite one source raster onto `dst` (document-sized, straight alpha) inside
 * `rect`, honouring the source's offset, opacity, blend mode, optional mask (same size
 * as `src`) and optional document-sized clip alpha.
 */
export function blendRasterInto(
  dst: Raster,
  src: Raster,
  offset: Point,
  opacity: number,
  mode: BlendMode,
  mask: Raster | null,
  rect: Rect,
  clip: Uint8Array | null,
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
    let ci = y * dw + area.x;
    for (let x = 0; x < area.w; x++, di += 4, si += 4, ci++) {
      let as = s[si + 3]! * inv * opacity;
      if (m) as *= m[si]! * inv;
      if (clip) as *= clip[ci]! * inv;
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
      compositeStraight(mode, d[di]! * inv, d[di + 1]! * inv, d[di + 2]! * inv, ab, s[si]! * inv, s[si + 1]! * inv, s[si + 2]! * inv, as, px);
      d[di] = px[0]! * 255;
      d[di + 1] = px[1]! * 255;
      d[di + 2] = px[2]! * 255;
      d[di + 3] = px[3]! * 255;
    }
  }
}

/** Mask value (0..255) of a document-anchored mask at doc coords; 255 outside its bounds. */
function docMaskAt(mask: Raster, offset: Point, x: number, y: number): number {
  const lx = x - offset.x;
  const ly = y - offset.y;
  if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height) return 255;
  return mask.data[(ly * mask.width + lx) * 4]!;
}

/**
 * Apply an adjustment layer to `out` inside `rect`: run the op on the composite so far
 * (with the op's margin), then lerp the color towards the result by `opacity × mask ×
 * clip` with the layer's blend mode. Alpha is never changed.
 */
export function applyAdjustmentInto(doc: Document, out: Raster, layer: AdjustmentLayer, rect: Rect, clip: Uint8Array | null): void {
  const op = opById(layer.op);
  if (!op || layer.opacity <= 0) return;
  const area = Rect.intersect(rect, Rect.ofSize(doc.width, doc.height));
  if (Rect.isEmpty(area)) return;
  const margin = Math.max(0, Math.ceil(op.margin?.(layer.params) ?? 0));
  const work = Rect.intersect(Rect.inflate(area, margin), Rect.ofSize(doc.width, doc.height));
  const src = out.crop(work);
  const res = op.cpu(src, layer.params);
  const d = out.data;
  const r = res.data;
  const mask = maskActive(layer) ? layer.mask : null;
  const inv = 1 / 255;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const di = (y * doc.width + x) * 4;
      const ab = d[di + 3]!;
      if (ab === 0) continue;
      let t = layer.opacity;
      if (mask) t *= docMaskAt(mask, layer.offset, x, y) * inv;
      if (clip) t *= clip[y * doc.width + x]! * inv;
      if (t <= 0) continue;
      const ri = ((y - work.y) * work.w + (x - work.x)) * 4;
      let nr = r[ri]!;
      let ng = r[ri + 1]!;
      let nb = r[ri + 2]!;
      if (layer.blendMode !== BlendMode.Normal) {
        blendRgb(layer.blendMode, d[di]! * inv, d[di + 1]! * inv, d[di + 2]! * inv, nr * inv, ng * inv, nb * inv, rgbTmp);
        nr = rgbTmp[0]! * 255;
        ng = rgbTmp[1]! * 255;
        nb = rgbTmp[2]! * 255;
      }
      d[di] = d[di]! + (nr - d[di]!) * t;
      d[di + 1] = d[di + 1]! + (ng - d[di + 1]!) * t;
      d[di + 2] = d[di + 2]! + (nb - d[di + 2]!) * t;
    }
  }
}

/** Composite one non-group layer (with its mask, effects, fill opacity) onto `out`. */
function blendLayer(doc: Document, out: Raster, layer: Layer, rect: Rect, clip: Uint8Array | null, ctx: Ctx, opacityOverride?: number, modeOverride?: BlendMode): void {
  const opacity = opacityOverride ?? layer.opacity;
  const mode = modeOverride ?? layer.blendMode;
  if (layer.kind === "adjustment") {
    applyAdjustmentInto(doc, out, { ...layer, opacity, blendMode: mode }, rect, clip);
    return;
  }
  const src = ctx.cache.styledSource(doc, layer);
  if (!src) return;
  if (src.styled) {
    blendRasterInto(out, src.raster, src.offset, opacity, mode, null, rect, clip);
    return;
  }
  let raster = src.raster;
  let mask = maskActive(layer) ? layer.mask : null;
  if (mask && (mask.width !== raster.width || mask.height !== raster.height)) {
    // Masks are normally layer-sized; tolerate a mismatch by resampling nothing and
    // treating the mask as anchored at the layer origin (outside = reveal).
    const copy = raster.clone();
    const d = copy.data;
    for (let y = 0; y < copy.height; y++) {
      for (let x = 0; x < copy.width; x++) {
        const i = (y * copy.width + x) * 4;
        const mv = x < mask.width && y < mask.height ? mask.data[(y * mask.width + x) * 4]! : 255;
        d[i + 3] = (d[i + 3]! * mv) / 255;
      }
    }
    raster = copy;
    mask = null;
  }
  blendRasterInto(out, raster, src.offset, opacity * layer.fillOpacity, mode, mask, rect, clip);
}

/** Lerp `out` towards `src` (both document-sized) by `t × mask` inside `rect` (pass-through groups). */
function lerpInto(out: Raster, src: Raster, rect: Rect, t: number, mask: Raster | null, maskOffset: Point): void {
  const d = out.data;
  const s = src.data;
  const w = out.width;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * w + x) * 4;
      let k = t;
      if (mask) k *= docMaskAt(mask, maskOffset, x, y) / 255;
      if (k <= 0) continue;
      // Lerp in premultiplied space so alpha and color stay consistent.
      const aa = d[i + 3]! / 255;
      const ba = s[i + 3]! / 255;
      const ao = aa + (ba - aa) * k;
      if (ao <= 0) {
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const pa = d[i + c]! * aa;
        const pb = s[i + c]! * ba;
        d[i + c] = (pa + (pb - pa) * k) / ao;
      }
      d[i + 3] = ao * 255;
    }
  }
}

function compositeGroup(doc: Document, out: Raster, group: GroupLayer, rect: Rect, ctx: Ctx): void {
  const children = childrenOf(doc, group.id);
  if (children.length === 0) return;
  const hasMask = maskActive(group);
  if (group.passThrough) {
    if (group.opacity >= 1 && !hasMask) {
      compositeSiblings(doc, children, out, rect, ctx);
      return;
    }
    const tmp = out.clone();
    compositeSiblings(doc, children, tmp, rect, ctx);
    lerpInto(out, tmp, rect, group.opacity, hasMask ? group.mask : null, group.offset);
    return;
  }
  const tmp = new Raster(doc.width, doc.height);
  compositeSiblings(doc, children, tmp, rect, ctx);
  blendRasterInto(out, tmp, { x: 0, y: 0 }, group.opacity, group.blendMode, hasMask && group.mask!.width === doc.width && group.mask!.height === doc.height ? group.mask : null, rect, null);
}

/** Composite a clipping unit: the base plus its clipped layers, then blend as one. */
function compositeClipUnit(doc: Document, out: Raster, base: Layer, chain: readonly Layer[], rect: Rect, ctx: Ctx): void {
  if (base.kind === "adjustment") {
    // An adjustment base clips nothing visible; just apply it and the chain normally.
    blendLayer(doc, out, base, rect, null, ctx);
    for (const c of chain) if (ctx.ignoreVisibility || c.visible) blendLayer(doc, out, c, rect, null, ctx);
    return;
  }
  const unit = new Raster(doc.width, doc.height);
  blendLayer(doc, unit, base, rect, null, ctx, 1, BlendMode.Normal);
  const clip = ctx.cache.clipAlpha(doc, base);
  for (const c of chain) {
    if (!ctx.ignoreVisibility && !c.visible) continue;
    blendLayer(doc, unit, c, rect, clip, ctx);
  }
  blendRasterInto(out, unit, { x: 0, y: 0 }, base.opacity, base.blendMode, null, rect, null);
}

/** Composite a run of sibling layers (bottom to top) onto `out` inside `rect`. */
function compositeSiblings(doc: Document, layers: readonly Layer[], out: Raster, rect: Rect, ctx: Ctx): void {
  const area = Rect.intersect(rect, Rect.ofSize(doc.width, doc.height));
  if (Rect.isEmpty(area)) return;
  let i = 0;
  while (i < layers.length) {
    const layer = layers[i]!;
    let j = i + 1;
    const chain: Layer[] = [];
    if (layer.kind !== "group") {
      while (j < layers.length && layers[j]!.clipToBelow && layers[j]!.kind !== "group") {
        chain.push(layers[j]!);
        j++;
      }
    }
    const visible = ctx.ignoreVisibility || layer.visible;
    if (visible) {
      if (layer.kind === "group") compositeGroup(doc, out, layer, area, ctx);
      else if (chain.some((c) => ctx.ignoreVisibility || c.visible)) compositeClipUnit(doc, out, layer, chain, area, ctx);
      else blendLayer(doc, out, layer, area, null, ctx);
    }
    i = j;
  }
}

/**
 * Reference CPU composite of the document (straight alpha RGBA8, document size). Used
 * for exports, AI inputs, merges and tests. The WebGL2 compositor implements the same
 * math on the GPU (and uses the CPU path for layer styles, cached per layer).
 */
export function compositeToRaster(doc: Document, opts: CompositeOptions = {}): Raster {
  const out = opts.into ?? new Raster(doc.width, doc.height);
  if (out.width !== doc.width || out.height !== doc.height) {
    throw new RangeError("compositeToRaster: `into` must be document-sized");
  }
  const rect = Rect.intersect(opts.rect ?? Rect.ofSize(doc.width, doc.height), Rect.ofSize(doc.width, doc.height));
  if (Rect.isEmpty(rect)) return out;
  out.clear(rect);
  let layers = topLevelLayers(doc);
  if (opts.layerIds) layers = layers.filter((l) => opts.layerIds!.includes(l.id));
  compositeSiblings(doc, layers, out, rect, { ignoreVisibility: opts.ignoreVisibility ?? false, cache: opts.cache ?? docStyleCache(doc) ?? new StyleCache() });
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

/** Total bytes held by layer rasters, masks, channels and the selection (for status bars and budgets). */
export function documentByteSize(doc: Document): number {
  let n = doc.selection.byteLength();
  for (const l of doc.layers) {
    const r = isPixelLayer(l) ? l.raster : null;
    if (r) n += r.byteLength();
    if (l.mask) n += l.mask.byteLength();
    if (l.kind === "fill" && l.fill.type === "pattern") n += l.fill.pattern.byteLength();
  }
  for (const c of doc.alphaChannels) n += c.mask.byteLength();
  if (doc.quickMask.raster) n += doc.quickMask.raster.byteLength();
  return n;
}

/** Render only a fill layer (for thumbnails). */
export function fillLayerPreview(doc: Document, layer: FillLayer): Raster {
  return fillLayerRaster(layer, doc.width, doc.height);
}
