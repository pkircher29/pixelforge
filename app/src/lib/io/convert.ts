/**
 * Pure conversions between IPC frames / manifests and engine documents. No Tauri here,
 * so everything is unit-testable.
 */
import {
  BlendMode,
  Raster,
  Selection,
  createDocument,
  createGroupLayer,
  createRasterLayer,
  isBlendMode,
  type Document,
  type Layer,
  type LayerId,
} from "$lib/engine";
import { AI_HISTORY_KEY } from "$lib/ai/history";
import { withoutDiffOverlays } from "$lib/ai/overlay";
import type { Frame, FrameHeader } from "./frame";

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

export interface ManifestLayer {
  id: string;
  name: string;
  kind: "raster" | "group";
  parent: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  blend_mode: string;
  visible: boolean;
  locked: boolean;
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
  selection?: Omit<PixelRef, "id">;
  thumbnail?: Omit<PixelRef, "id">;
}

export interface ProjectHeader extends ProjectHeaderBody, FrameHeader {}

export function documentFromProjectFrame(frame: Frame<ProjectHeader>): Document {
  const h = frame.header;
  const m = h.manifest;
  const doc = createDocument({ name: m.doc.name || "Untitled", width: m.doc.width, height: m.doc.height, noBackgroundLayer: true });
  const pixels = new Map(h.layers.map((r) => [r.id, r]));
  const masks = new Map((h.masks ?? []).map((r) => [r.id, r]));
  const entries = m.layers.map((e, i) => ({ e, i }));
  const indexOfId = new Map(m.layers.map((l, i) => [l.id, i]));
  const ordered = groupsBeforeChildren(
    entries,
    (x) => x.e.kind === "group",
    (x) => (x.e.parent ? (indexOfId.get(x.e.parent) ?? null) : null),
  );
  const idMap = new Map<string, LayerId>();
  for (const { e } of ordered) {
    const common = {
      name: e.name ?? "Layer",
      opacity: Math.max(0, Math.min(1, e.opacity ?? 1)),
      visible: e.visible ?? true,
      locked: e.locked ?? false,
      blendMode: blendFromFile(e.blend_mode),
    };
    if (e.kind === "group") {
      const g = createGroupLayer(doc, { ...common, id: e.id });
      idMap.set(e.id, g.id);
      doc.layers.push(g);
      continue;
    }
    const ref = pixels.get(e.id);
    const w = ref?.width ?? e.width;
    const hh = ref?.height ?? e.height;
    let raster: Raster;
    const blob = ref ? frame.blobs[ref.blob] : undefined;
    if (blob && blob.byteLength === w * hh * 4) raster = Raster.fromBytes(w, hh, blob);
    else raster = new Raster(Math.max(1, w), Math.max(1, hh));
    const layer = createRasterLayer(doc, {
      ...common,
      id: e.id,
      raster,
      offset: { x: e.x ?? 0, y: e.y ?? 0 },
      parentId: e.parent ? (idMap.get(e.parent) ?? null) : null,
    });
    const mref = masks.get(e.id);
    const mblob = mref ? frame.blobs[mref.blob] : undefined;
    if (mref && mblob && mblob.byteLength === mref.width * mref.height) {
      layer.mask = grayToRaster(mblob, mref.width, mref.height);
    }
    idMap.set(e.id, layer.id);
    doc.layers.push(layer);
  }
  if (h.selection) {
    const b = frame.blobs[h.selection.blob];
    if (b && b.byteLength === doc.width * doc.height) {
      doc.selection = Selection.fromMask(doc.width, doc.height, new Uint8Array(b));
    }
  }
  doc.activeLayerId = (m.active_layer && idMap.get(m.active_layer)) || doc.layers[doc.layers.length - 1]?.id || null;
  doc.meta.projectId = m.doc.id;
  doc.meta.created = m.created;
  // Manifest `ai_history` (snake_case) <-> in-memory `doc.meta.aiHistory` (docs/ai-history.md).
  doc.meta[AI_HISTORY_KEY] = Array.isArray(m.ai_history) ? m.ai_history : [];
  doc.meta.manifestExtra = stripKnown(m);
  return doc;
}

function stripKnown(m: Manifest): Record<string, unknown> {
  const known = new Set(["format", "app_version", "created", "modified", "doc", "layers", "active_layer", "selection", "thumbnail", "ai_history"]);
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

/**
 * Build the `io_save_pfproj` header + blobs for a document. AI diff overlay layers
 * (`aidiff_*`, non-undoable screen-only helpers) are never written.
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
  const fileOrder = childrenBeforeGroups(doc.layers);
  const manifestLayers: ManifestLayer[] = fileOrder.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    parent: l.parentId,
    x: l.kind === "raster" ? l.offset.x : 0,
    y: l.kind === "raster" ? l.offset.y : 0,
    width: l.kind === "raster" ? l.raster.width : 0,
    height: l.kind === "raster" ? l.raster.height : 0,
    opacity: l.opacity,
    blend_mode: blendToFile(l.blendMode),
    visible: l.visible,
    locked: l.locked,
  }));
  for (const l of fileOrder) {
    if (l.kind !== "raster") continue;
    layers.push({ id: l.id, width: l.raster.width, height: l.raster.height, blob: blobs.length, encoding: "rgba" });
    blobs.push(bytesOf(l.raster.data));
    if (l.mask) {
      masks.push({ id: l.id, width: l.mask.width, height: l.mask.height, blob: blobs.length, encoding: "gray" });
      blobs.push(redChannel(l.mask));
    }
  }
  const extra = (doc.meta.manifestExtra as Record<string, unknown> | undefined) ?? {};
  const manifest: Manifest = {
    ...extra,
    format: 1,
    app_version: appVersion,
    created: typeof doc.meta.created === "string" ? doc.meta.created : "",
    modified: "",
    doc: { id: typeof doc.meta.projectId === "string" ? doc.meta.projectId : doc.id, name: doc.name, width: doc.width, height: doc.height },
    layers: manifestLayers,
    active_layer: doc.activeLayerId,
    ai_history: Array.isArray(doc.meta[AI_HISTORY_KEY]) ? JSON.parse(JSON.stringify(doc.meta[AI_HISTORY_KEY])) : [],
  };
  const header: ProjectHeaderBody = { path, manifest, layers, masks };
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
