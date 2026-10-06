/**
 * Pure conversions between IPC frames / manifests and engine documents. No Tauri here,
 * so everything is unit-testable.
 *
 * `.pfproj` **format 2** (docs/pfproj-format.md): every v2 layer field, adjustment / fill /
 * shape / text layer specs, alpha channels (`channels/<id>.png`) and paths. The reader
 * accepts format 1 (missing fields take their defaults).
 */
import {
  BlendMode,
  Raster,
  Selection,
  createDocument,
  createGroupLayer,
  createRasterLayer,
  createAdjustmentLayer,
  createFillLayer,
  createShapeLayer,
  createTextLayer,
  defaultLock,
  isBlendMode,
  isPixelLayer,
  textSpec,
  type AlphaChannel,
  type Document,
  type FillSpec,
  type GradientFill,
  type Layer,
  type LayerColor,
  type LayerEffects,
  type LayerId,
  type LayerKind,
  type LayerLock,
  type Path,
  type RGBA,
  type SolidFill,
  type StrokeSpec,
  type TextSpec,
  type FillRule,
} from "$lib/engine";
import type { ParamValues } from "$lib/engine/ops/types";
import { AI_HISTORY_KEY } from "$lib/ai/history";
import { withoutDiffOverlays } from "$lib/ai/overlay";
import type { Frame, FrameHeader } from "./frame";

/** Manifest format written by this version. */
export const PFPROJ_FORMAT = 2;

/** `color-dodge` (engine) ↔ `color_dodge` (pfproj / IPC). */
export function blendToFile(m: BlendMode): string {
  return m.replace(/-/g, "_");
}

export function blendFromFile(s: unknown): BlendMode {
  if (typeof s !== "string") return BlendMode.Normal;
  const v = s.replace(/_/g, "-");
  return isBlendMode(v) ? v : BlendMode.Normal;
}

/**
 * Reorder a bottom-first list in which a group entry sits **after** its children
 * (PSD / pfproj convention) into engine order (group **before** its children).
 * `groupOf(i)` returns the index of item `i`'s group entry, or null.
 */
export function groupsBeforeChildren<T>(items: readonly T[], isGroup: (t: T) => boolean, groupOf: (t: T, i: number) => number | null): T[] {
  const out: T[] = [];
  const groupIdx = new Set<number>();
  items.forEach((t, i) => {
    if (isGroup(t)) groupIdx.add(i);
  });
  for (let i = 0; i < items.length; i++) {
    const t = items[i]!;
    if (isGroup(t)) {
      out.push(t);
      for (let j = 0; j < items.length; j++) {
        const g = groupOf(items[j]!, j);
        if (g === i && !isGroup(items[j]!)) out.push(items[j]!);
      }
      continue;
    }
    const g = groupOf(t, i);
    if (g === null || !groupIdx.has(g)) out.push(t);
  }
  return out;
}

/** Engine order (group first) → file order (children first, group above them). */
export function childrenBeforeGroups(layers: readonly Layer[]): Layer[] {
  const out: Layer[] = [];
  let i = 0;
  while (i < layers.length) {
    const l = layers[i]!;
    if (l.kind === "group") {
      let j = i + 1;
      while (j < layers.length && layers[j]!.parentId === l.id) {
        out.push(layers[j]!);
        j++;
      }
      out.push(l);
      i = j;
    } else {
      out.push(l);
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- io_open frames

export interface OpenLayerEntry {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  visible: boolean;
  blendMode: string;
  isGroup: boolean;
  groupDepth: number;
  group: number | null;
  blob: number | null;
}

export interface OpenHeader extends FrameHeader {
  width: number;
  height: number;
  sourceFormat: string;
  layers: OpenLayerEntry[];
}

/** Build a document from an `io_open` / `io_decode` frame. */
export function documentFromOpenFrame(frame: Frame<OpenHeader>, name: string): Document {
  const h = frame.header;
  const doc = createDocument({ name, width: h.width, height: h.height, noBackgroundLayer: true });
  const entries = h.layers.map((e, i) => ({ e, i }));
  const ordered = groupsBeforeChildren(entries, (x) => x.e.isGroup, (x) => x.e.group);
  const groupIds = new Map<number, LayerId>();
  for (const { e, i } of ordered) {
    const common = {
      name: e.name || (e.isGroup ? "Group" : "Layer"),
      opacity: Math.max(0, Math.min(1, e.opacity ?? 1)),
      visible: e.visible ?? true,
      blendMode: blendFromFile(e.blendMode),
    };
    if (e.isGroup) {
      const g = createGroupLayer(doc, common);
      groupIds.set(i, g.id);
      doc.layers.push(g);
      continue;
    }
    const parentId = e.group !== null ? (groupIds.get(e.group) ?? null) : null;
    let raster: Raster;
    if (e.blob !== null && frame.blobs[e.blob] && e.w > 0 && e.h > 0) {
      const bytes = frame.blobs[e.blob]!;
      raster = bytes.byteLength === e.w * e.h * 4 ? Raster.fromBytes(e.w, e.h, bytes) : new Raster(e.w, e.h);
    } else {
      raster = new Raster(Math.max(1, e.w), Math.max(1, e.h));
    }
    doc.layers.push(createRasterLayer(doc, { ...common, raster, offset: { x: e.x, y: e.y }, parentId }));
  }
  if (doc.layers.length === 0) {
    doc.layers.push(createRasterLayer(doc, { name: "Background" }));
  }
  // Active: topmost raster layer.
  const top = [...doc.layers].reverse().find((l) => l.kind === "raster") ?? doc.layers[doc.layers.length - 1]!;
  doc.activeLayerId = top.id;
  doc.meta.sourceFormat = h.sourceFormat;
  return doc;
}

// ---------------------------------------------------------------- .pfproj

/** Pattern tiles are small; they travel inline as base64 RGBA inside the manifest. */
export interface ManifestPattern {
  width: number;
  height: number;
  rgba: string;
}

export type ManifestFill = SolidFill | GradientFill | { type: "pattern"; scale: number; offset: { x: number; y: number }; pattern: ManifestPattern };

export interface ManifestShape {
  path: Path;
  fill: SolidFill | GradientFill | null;
  stroke: StrokeSpec | null;
  fill_rule: FillRule;
}

export interface ManifestLayer {
  id: string;
  name: string;
  kind: LayerKind;
  parent: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  blend_mode: string;
  visible: boolean;
  locked: boolean;
  // ---- format 2 (all optional for format-1 readers/writers)
  fill_opacity?: number;
  mask_enabled?: boolean;
  mask_linked?: boolean;
  clip_to_below?: boolean;
  lock?: LayerLock;
  linked_to?: string[];
  color?: LayerColor | null;
  effects?: LayerEffects | null;
  pass_through?: boolean;
  adjustment?: { op: string; params: ParamValues };
  fill?: ManifestFill;
  shape?: ManifestShape;
  text?: TextSpec;
  file?: string;
  mask?: string;
  [extra: string]: unknown;
}

export interface ManifestChannel {
  id: string;
  name: string;
  color: [number, number, number];
  opacity: number;
  file?: string;
  [extra: string]: unknown;
}

export interface Manifest {
  format: number;
  app_version: string;
  created: string;
  modified: string;
  doc: { id: string; name: string; width: number; height: number; [extra: string]: unknown };
  layers: ManifestLayer[];
  active_layer: string | null;
  selection?: { file?: string };
  thumbnail?: string;
  ai_history: unknown[];
  /** Format 2. */
  channels?: ManifestChannel[];
  paths?: Path[];
  work_path?: string | null;
  [extra: string]: unknown;
}

export interface PixelRef {
  id: string;
  width: number;
  height: number;
  blob: number;
  encoding?: "rgba" | "gray" | "png";
}

/** Header fields without the frame's `blobs` / index signature (what the UI builds). */
export interface ProjectHeaderBody {
  path: string;
  manifest: Manifest;
  layers: PixelRef[];
  masks?: PixelRef[];
  /** Format 2: alpha channels (gray, canvas-sized), keyed by channel id. */
  channels?: PixelRef[];
  selection?: Omit<PixelRef, "id">;
  thumbnail?: Omit<PixelRef, "id">;
}

export interface ProjectHeader extends ProjectHeaderBody, FrameHeader {}

const KNOWN_KINDS: readonly LayerKind[] = ["raster", "group", "adjustment", "fill", "shape", "text"];

function rgbaOf(v: unknown, fallback: RGBA): RGBA {
  if (!v || typeof v !== "object") return { ...fallback };
  const o = v as Record<string, unknown>;
  const n = (k: string, d: number): number => (typeof o[k] === "number" ? (o[k] as number) : d);
  return { r: n("r", fallback.r), g: n("g", fallback.g), b: n("b", fallback.b), a: n("a", fallback.a) };
}

function fillToFile(f: FillSpec): ManifestFill {
  if (f.type === "pattern") {
    return {
      type: "pattern",
      scale: f.scale,
      offset: { x: f.offset.x, y: f.offset.y },
      pattern: { width: f.pattern.width, height: f.pattern.height, rgba: bytesToBase64(bytesOf(f.pattern.data)) },
    };
  }
  return JSON.parse(JSON.stringify(f)) as ManifestFill;
}

function fillFromFile(v: unknown): FillSpec | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type === "solid") return { type: "solid", color: rgbaOf(o.color, { r: 0, g: 0, b: 0, a: 255 }) };
  if (o.type === "gradient") {
    const g = o.gradient as { stops?: unknown[] } | undefined;
    const stops = Array.isArray(g?.stops)
      ? g!.stops.map((s) => {
          const so = (s ?? {}) as Record<string, unknown>;
          return { pos: typeof so.pos === "number" ? so.pos : 0, color: rgbaOf(so.color, { r: 0, g: 0, b: 0, a: 255 }) };
        })
      : [];
    const off = (o.offset ?? {}) as Record<string, unknown>;
    return {
      type: "gradient",
      gradient: { stops },
      style: (["linear", "radial", "angle", "reflected", "diamond"] as const).includes(o.style as never) ? (o.style as GradientFill["style"]) : "linear",
      angle: typeof o.angle === "number" ? o.angle : 90,
      scale: typeof o.scale === "number" ? o.scale : 1,
      reverse: o.reverse === true,
      offset: { x: typeof off.x === "number" ? off.x : 0, y: typeof off.y === "number" ? off.y : 0 },
    };
  }
  if (o.type === "pattern") {
    const p = (o.pattern ?? {}) as Record<string, unknown>;
    const w = typeof p.width === "number" ? p.width : 0;
    const h = typeof p.height === "number" ? p.height : 0;
    let pattern = new Raster(Math.max(1, w), Math.max(1, h));
    if (typeof p.rgba === "string" && w > 0 && h > 0) {
      const bytes = base64ToBytes(p.rgba);
      if (bytes.byteLength === w * h * 4) pattern = Raster.fromBytes(w, h, bytes);
    }
    const off = (o.offset ?? {}) as Record<string, unknown>;
    return { type: "pattern", pattern, scale: typeof o.scale === "number" ? o.scale : 1, offset: { x: typeof off.x === "number" ? off.x : 0, y: typeof off.y === "number" ? off.y : 0 } };
  }
  return null;
}

function strokeFromFile(v: unknown): StrokeSpec | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fill = fillFromFile(o.fill);
  if (!fill || fill.type === "pattern") return null;
  return {
    width: typeof o.width === "number" ? o.width : 1,
    fill,
    position: o.position === "inside" || o.position === "outside" ? o.position : "center",
    cap: o.cap === "round" || o.cap === "square" ? o.cap : "butt",
    join: o.join === "round" || o.join === "bevel" ? o.join : "miter",
    dash: Array.isArray(o.dash) ? (o.dash as unknown[]).filter((d): d is number => typeof d === "number") : null,
  };
}

function pathFromFile(v: unknown): Path | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !Array.isArray(o.subpaths)) return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : "Path",
    subpaths: (o.subpaths as unknown[]).map((sp) => {
      const so = (sp ?? {}) as Record<string, unknown>;
      const anchors = Array.isArray(so.anchors) ? (so.anchors as unknown[]) : [];
      return {
        closed: so.closed === true,
        anchors: anchors.map((a) => {
          const ao = (a ?? {}) as Record<string, number | string>;
          const n = (k: string, d: number): number => (typeof ao[k] === "number" ? (ao[k] as number) : d);
          const x = n("x", 0);
          const y = n("y", 0);
          return { x, y, inX: n("inX", x), inY: n("inY", y), outX: n("outX", x), outY: n("outY", y), type: ao.type === "smooth" ? ("smooth" as const) : ("corner" as const) };
        }),
      };
    }),
  };
}

function textFromFile(v: unknown): TextSpec | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string") return null;
  const base = textSpec(o.text, typeof o.x === "number" ? o.x : 0, typeof o.y === "number" ? o.y : 0);
  return {
    ...base,
    font: typeof o.font === "string" ? o.font : base.font,
    size: typeof o.size === "number" ? o.size : base.size,
    color: rgbaOf(o.color, base.color),
    align: o.align === "center" || o.align === "right" ? o.align : "left",
    leading: typeof o.leading === "number" ? o.leading : null,
    tracking: typeof o.tracking === "number" ? o.tracking : 0,
    bold: o.bold === true,
    italic: o.italic === true,
    vertical: o.vertical === true,
    antialias: o.antialias !== false,
  };
}

function lockFromFile(v: unknown, legacyLocked: boolean): LayerLock {
  const base = defaultLock();
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["transparent", "pixels", "position", "all"] as const) if (typeof o[k] === "boolean") base[k] = o[k] as boolean;
  }
  if (legacyLocked) base.all = true;
  return base;
}

const LAYER_COLORS: readonly LayerColor[] = ["red", "orange", "yellow", "green", "blue", "violet", "gray"];

export function documentFromProjectFrame(frame: Frame<ProjectHeader>): Document {
  const h = frame.header;
  const m = h.manifest;
  if (typeof m.format === "number" && m.format > PFPROJ_FORMAT) {
    throw new Error(`Project format ${m.format} is newer than this version supports (${PFPROJ_FORMAT})`);
  }
  const doc = createDocument({ name: m.doc.name || "Untitled", width: m.doc.width, height: m.doc.height, noBackgroundLayer: true });
  const pixels = new Map(h.layers.map((r) => [r.id, r]));
  const masks = new Map((h.masks ?? []).map((r) => [r.id, r]));
  const channels = new Map((h.channels ?? []).map((r) => [r.id, r]));
  const entries = m.layers.map((e, i) => ({ e, i }));
  const indexOfId = new Map(m.layers.map((l, i) => [l.id, i]));
  const ordered = groupsBeforeChildren(
    entries,
    (x) => x.e.kind === "group",
    (x) => (x.e.parent ? (indexOfId.get(x.e.parent) ?? null) : null),
  );
  const idMap = new Map<string, LayerId>();
  for (const { e } of ordered) {
    const kind: LayerKind = KNOWN_KINDS.includes(e.kind) ? e.kind : "raster";
    const common = {
      id: e.id,
      name: e.name ?? "Layer",
      opacity: Math.max(0, Math.min(1, e.opacity ?? 1)),
      visible: e.visible ?? true,
      locked: e.locked ?? false,
      blendMode: blendFromFile(e.blend_mode),
      fillOpacity: typeof e.fill_opacity === "number" ? Math.max(0, Math.min(1, e.fill_opacity)) : 1,
      maskEnabled: e.mask_enabled !== false,
      maskLinked: e.mask_linked !== false,
      clipToBelow: e.clip_to_below === true,
      lock: lockFromFile(e.lock, e.locked ?? false),
      effects: e.effects && typeof e.effects === "object" ? (JSON.parse(JSON.stringify(e.effects)) as LayerEffects) : null,
      linkedTo: Array.isArray(e.linked_to) ? e.linked_to.filter((x): x is string => typeof x === "string") : [],
      color: LAYER_COLORS.includes(e.color as LayerColor) ? (e.color as LayerColor) : null,
      parentId: e.parent ? (idMap.get(e.parent) ?? null) : null,
      offset: { x: e.x ?? 0, y: e.y ?? 0 },
    };
    let layer: Layer;
    if (kind === "group") {
      layer = createGroupLayer(doc, { ...common, passThrough: e.pass_through !== false });
    } else if (kind === "adjustment" && e.adjustment && typeof e.adjustment.op === "string") {
      layer = createAdjustmentLayer(doc, { ...common, op: e.adjustment.op, params: (e.adjustment.params ?? {}) as ParamValues });
    } else if (kind === "fill" && fillFromFile(e.fill)) {
      layer = createFillLayer(doc, { ...common, fill: fillFromFile(e.fill)! });
    } else if (kind === "shape" && e.shape && pathFromFile(e.shape.path)) {
      const fill = fillFromFile(e.shape.fill);
      layer = createShapeLayer(doc, {
        ...common,
        path: pathFromFile(e.shape.path)!,
        fill: fill && fill.type !== "pattern" ? fill : e.shape.fill === null ? null : { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } },
        stroke: strokeFromFile(e.shape.stroke),
        fillRule: e.shape.fill_rule === "evenodd" ? "evenodd" : "nonzero",
      });
    } else if (kind === "text" && textFromFile(e.text)) {
      layer = createTextLayer(doc, { ...common, text: textFromFile(e.text)! });
    } else {
      // Raster, or a spec-less shape / text / fill / adjustment entry: keep the cached pixels.
      const ref = pixels.get(e.id);
      const w = ref?.width ?? e.width;
      const hh = ref?.height ?? e.height;
      let raster: Raster;
      const blob = ref ? frame.blobs[ref.blob] : undefined;
      if (blob && blob.byteLength === w * hh * 4) raster = Raster.fromBytes(w, hh, blob);
      else raster = new Raster(Math.max(1, w), Math.max(1, hh));
      layer = createRasterLayer(doc, { ...common, raster });
    }
    const mref = masks.get(e.id);
    const mblob = mref ? frame.blobs[mref.blob] : undefined;
    if (mref && mblob && mblob.byteLength === mref.width * mref.height) {
      layer.mask = grayToRaster(mblob, mref.width, mref.height);
    }
    idMap.set(e.id, layer.id);
    doc.layers.push(layer);
  }
  // Linked ids survive as-is (ids are preserved); drop dangling ones.
  const ids = new Set(doc.layers.map((l) => l.id));
  for (const l of doc.layers) l.linkedTo = l.linkedTo.filter((x) => ids.has(x) && x !== l.id);
  if (h.selection) {
    const b = frame.blobs[h.selection.blob];
    if (b && b.byteLength === doc.width * doc.height) {
      doc.selection = Selection.fromMask(doc.width, doc.height, new Uint8Array(b));
    }
  }
  for (const c of m.channels ?? []) {
    const ref = channels.get(c.id);
    const blob = ref ? frame.blobs[ref.blob] : undefined;
    if (!ref || !blob || blob.byteLength !== doc.width * doc.height) continue;
    const color = Array.isArray(c.color) && c.color.length >= 3 ? { r: c.color[0]!, g: c.color[1]!, b: c.color[2]!, a: 255 } : { r: 255, g: 0, b: 0, a: 255 };
    const ch: AlphaChannel = { id: c.id, name: typeof c.name === "string" ? c.name : "Alpha", mask: grayToRaster(blob, doc.width, doc.height), color, opacity: typeof c.opacity === "number" ? c.opacity : 0.5 };
    doc.alphaChannels.push(ch);
  }
  doc.paths = Array.isArray(m.paths) ? m.paths.map(pathFromFile).filter((p): p is Path => !!p) : [];
  doc.workPathId = typeof m.work_path === "string" && doc.paths.some((p) => p.id === m.work_path) ? m.work_path : null;
  doc.activeLayerId = (m.active_layer && idMap.get(m.active_layer)) || doc.layers[doc.layers.length - 1]?.id || null;
  doc.meta.projectId = m.doc.id;
  doc.meta.created = m.created;
  // Manifest `ai_history` (snake_case) <-> in-memory `doc.meta.aiHistory` (docs/ai-history.md).
  doc.meta[AI_HISTORY_KEY] = Array.isArray(m.ai_history) ? m.ai_history : [];
  doc.meta.manifestExtra = stripKnown(m);
  return doc;
}

function stripKnown(m: Manifest): Record<string, unknown> {
  const known = new Set(["format", "app_version", "created", "modified", "doc", "layers", "active_layer", "selection", "thumbnail", "ai_history", "channels", "paths", "work_path"]);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m)) if (!known.has(k)) out[k] = m[k];
  return out;
}

function grayToRaster(bytes: Uint8Array, w: number, h: number): Raster {
  const r = new Raster(w, h);
  const d = r.data;
  for (let i = 0, p = 0; i < bytes.length; i++, p += 4) {
    const v = bytes[i]!;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  return r;
}

/** Kind-specific manifest fields of a layer. */
function layerSpec(l: Layer): Partial<ManifestLayer> {
  switch (l.kind) {
    case "group":
      return { pass_through: l.passThrough };
    case "adjustment":
      return { adjustment: { op: l.op, params: JSON.parse(JSON.stringify(l.params)) as ParamValues } };
    case "fill":
      return { fill: fillToFile(l.fill) };
    case "shape":
      return {
        shape: {
          path: JSON.parse(JSON.stringify(l.path)) as Path,
          fill: l.fill ? (JSON.parse(JSON.stringify(l.fill)) as SolidFill | GradientFill) : null,
          stroke: l.stroke ? (JSON.parse(JSON.stringify(l.stroke)) as StrokeSpec) : null,
          fill_rule: l.fillRule,
        },
      };
    case "text":
      return { text: JSON.parse(JSON.stringify(l.text)) as TextSpec };
    default:
      return {};
  }
}

/**
 * Build the `io_save_pfproj` header + blobs for a document (format 2). AI diff overlay
 * layers (`aidiff_*`, non-undoable screen-only helpers) are never written. Shape and
 * text layers write their spec **and** their cached raster (`layers/<id>.png`) so older
 * readers still see pixels.
 */
export function projectFrameParts(
  source: Document,
  path: string,
  appVersion: string,
  thumbnail: Raster | null,
): { header: ProjectHeaderBody; blobs: Uint8Array[] } {
  const doc = withoutDiffOverlays(source);
  const blobs: Uint8Array[] = [];
  const layers: PixelRef[] = [];
  const masks: PixelRef[] = [];
  const channels: PixelRef[] = [];
  const fileOrder = childrenBeforeGroups(doc.layers);
  const manifestLayers: ManifestLayer[] = fileOrder.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    parent: l.parentId,
    x: l.kind === "group" ? 0 : l.offset.x,
    y: l.kind === "group" ? 0 : l.offset.y,
    width: isPixelLayer(l) ? l.raster.width : 0,
    height: isPixelLayer(l) ? l.raster.height : 0,
    opacity: l.opacity,
    blend_mode: blendToFile(l.blendMode),
    visible: l.visible,
    locked: l.locked || l.lock.all,
    fill_opacity: l.fillOpacity,
    mask_enabled: l.maskEnabled,
    mask_linked: l.maskLinked,
    clip_to_below: l.clipToBelow,
    lock: { ...l.lock },
    linked_to: l.linkedTo.slice(),
    color: l.color,
    effects: l.effects ? (JSON.parse(JSON.stringify(l.effects)) as LayerEffects) : null,
    ...layerSpec(l),
  }));
  for (const l of fileOrder) {
    if (isPixelLayer(l)) {
      layers.push({ id: l.id, width: l.raster.width, height: l.raster.height, blob: blobs.length, encoding: "rgba" });
      blobs.push(bytesOf(l.raster.data));
    }
    if (l.mask) {
      masks.push({ id: l.id, width: l.mask.width, height: l.mask.height, blob: blobs.length, encoding: "gray" });
      blobs.push(redChannel(l.mask));
    }
  }
  const extra = (doc.meta.manifestExtra as Record<string, unknown> | undefined) ?? {};
  const manifest: Manifest = {
    ...extra,
    format: PFPROJ_FORMAT,
    app_version: appVersion,
    created: typeof doc.meta.created === "string" ? doc.meta.created : "",
    modified: "",
    doc: { id: typeof doc.meta.projectId === "string" ? doc.meta.projectId : doc.id, name: doc.name, width: doc.width, height: doc.height },
    layers: manifestLayers,
    active_layer: doc.activeLayerId,
    ai_history: Array.isArray(doc.meta[AI_HISTORY_KEY]) ? JSON.parse(JSON.stringify(doc.meta[AI_HISTORY_KEY])) : [],
  };
  const header: ProjectHeaderBody = { path, manifest, layers, masks };
  if (doc.alphaChannels.length > 0) {
    manifest.channels = doc.alphaChannels.map((c) => ({ id: c.id, name: c.name, color: [c.color.r, c.color.g, c.color.b], opacity: c.opacity, file: `channels/${c.id}.png` }));
    for (const c of doc.alphaChannels) {
      channels.push({ id: c.id, width: c.mask.width, height: c.mask.height, blob: blobs.length, encoding: "gray" });
      blobs.push(redChannel(c.mask));
    }
    header.channels = channels;
  }
  if (doc.paths.length > 0) {
    manifest.paths = JSON.parse(JSON.stringify(doc.paths)) as Path[];
    manifest.work_path = doc.workPathId;
  }
  if (!doc.selection.isEmpty) {
    manifest.selection = { file: "selection.png" };
    header.selection = { width: doc.width, height: doc.height, blob: blobs.length, encoding: "gray" };
    blobs.push(new Uint8Array(doc.selection.mask));
  }
  if (thumbnail) {
    manifest.thumbnail = "thumb.png";
    header.thumbnail = { width: thumbnail.width, height: thumbnail.height, blob: blobs.length, encoding: "rgba" };
    blobs.push(bytesOf(thumbnail.data));
  }
  return { header, blobs };
}

export function bytesOf(d: Uint8ClampedArray): Uint8Array {
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
}

function redChannel(r: Raster): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = r.data[p]!;
  return out;
}

/** Base64 of raw bytes (chunked `btoa`, no Node `Buffer` dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** File name without directory or extension. */
export function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

export function extensionOf(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";
}

export const IMPORT_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "psd", "pfproj"];
