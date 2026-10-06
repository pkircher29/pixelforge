/**
 * Open / save / export against the Rust `io_*` commands (docs/ipc.md).
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Raster, compositeToRaster, type Document } from "$lib/engine";
import { withoutDiffOverlays } from "$lib/ai/overlay";
import { decodeFrame, encodeFrame } from "./frame";
import {
  IMPORT_EXTENSIONS,
  baseName,
  bytesOf,
  documentFromOpenFrame,
  documentFromProjectFrame,
  extensionOf,
  projectFrameParts,
  type OpenHeader,
  type ProjectHeader,
} from "./convert";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { ui } from "$lib/stores/ui.svelte";

import pkg from "../../../package.json";

export const APP_VERSION: string = pkg.version;

export type ExportFormat = "png" | "jpeg" | "webp";

export interface ExportOptions {
  quality?: number;
  lossless?: boolean;
  pngCompression?: "fast" | "best";
  background?: [number, number, number];
}

function requireTauri(): void {
  if (!isTauri()) throw { code: "no_tauri", message: "File access needs the desktop app (not the browser preview)." };
}

/** Open any supported file (image or .pfproj) into the doc store. Returns the entry. */
export async function openFile(path: string): Promise<OpenDoc> {
  requireTauri();
  let doc: Document;
  if (extensionOf(path) === "pfproj") {
    const buf = await invoke<ArrayBuffer>("io_open_pfproj", { path });
    doc = documentFromProjectFrame(decodeFrame<ProjectHeader>(buf));
  } else {
    const buf = await invoke<ArrayBuffer>("io_open", { path });
    doc = documentFromOpenFrame(decodeFrame<OpenHeader>(buf), baseName(path));
  }
  doc.dirty = false;
  const entry = docStore.open(doc, path);
  entry.dirty = false;
  await recentAdd(path);
  return entry;
}

/** Decode in-memory file bytes (drag-drop payloads, clipboard files). */
export async function decodeBytes(bytes: Uint8Array, name: string): Promise<Document> {
  requireTauri();
  const buf = await invoke<ArrayBuffer>("io_decode", bytes);
  return documentFromOpenFrame(decodeFrame<OpenHeader>(buf), name);
}

/** Native open dialog → paths (multiple). Null when cancelled. */
export async function pickOpenPaths(): Promise<string[] | null> {
  requireTauri();
  const res = await openDialog({
    multiple: true,
    title: "Open",
    filters: [
      { name: "All supported", extensions: IMPORT_EXTENSIONS },
      { name: "Pixelforge project", extensions: ["pfproj"] },
      { name: "Images", extensions: IMPORT_EXTENSIONS.filter((e) => e !== "pfproj") },
    ],
  });
  if (!res) return null;
  return Array.isArray(res) ? res : [res];
}

export async function pickSavePath(defaultName: string, kind: "pfproj" | ExportFormat): Promise<string | null> {
  requireTauri();
  const ext = kind === "jpeg" ? "jpg" : kind;
  const filters =
    kind === "pfproj"
      ? [{ name: "Pixelforge project", extensions: ["pfproj"] }]
      : [{ name: kind.toUpperCase(), extensions: kind === "jpeg" ? ["jpg", "jpeg"] : [kind] }];
  const res = await saveDialog({ title: kind === "pfproj" ? "Save project" : "Export", defaultPath: `${defaultName}.${ext}`, filters });
  if (!res) return null;
  return extensionOf(res) ? res : `${res}.${ext}`;
}

/** Write the document as `.pfproj`. */
export async function saveProject(entry: OpenDoc, path: string): Promise<void> {
  requireTauri();
  const doc = entry.doc;
  // The display name follows the file (Save As "poster.pfproj" -> "poster"); set it
  // before the manifest is built so `doc.name` in the file matches the tab on reopen.
  doc.name = baseName(path);
  const thumb = thumbnailOf(doc, 512);
  const { header, blobs } = projectFrameParts(doc, path, APP_VERSION, thumb);
  const body = encodeFrame({ ...header }, blobs);
  const res = await invoke<{ path: string; bytes: number; modified: string }>("io_save_pfproj", body);
  doc.meta.modified = res.modified;
  if (typeof doc.meta.created !== "string" || !doc.meta.created) doc.meta.created = res.modified;
  docStore.markSaved(res.path);
  await recentAdd(res.path);
}

/** Export the composite as PNG / JPEG / WebP (AI diff overlays are never exported). */
export async function exportComposite(doc: Document, path: string, format: ExportFormat, opts: ExportOptions = {}): Promise<number> {
  requireTauri();
  const comp = compositeToRaster(withoutDiffOverlays(doc));
  const body = encodeFrame({ path, format, opts, width: comp.width, height: comp.height, blob: 0 }, [bytesOf(comp.data)]);
  const res = await invoke<{ path: string; bytes: number }>("io_export", body);
  await recentAdd(res.path);
  return res.bytes;
}

/** Encode a raster to file bytes in memory (clipboard, AI uploads). */
export async function encodeRaster(r: Raster, format: ExportFormat = "png", opts: ExportOptions = {}): Promise<Uint8Array> {
  requireTauri();
  const body = encodeFrame({ path: "", format, opts, width: r.width, height: r.height, blob: 0 }, [bytesOf(r.data)]);
  return new Uint8Array(await invoke<ArrayBuffer>("io_encode", body));
}

function thumbnailOf(doc: Document, maxPx: number): Raster {
  const comp = compositeToRaster(withoutDiffOverlays(doc));
  const s = Math.min(1, maxPx / Math.max(comp.width, comp.height));
  if (s >= 1) return comp;
  return comp.resize(Math.max(1, Math.round(comp.width * s)), Math.max(1, Math.round(comp.height * s)), "bilinear");
}

// ---------------------------------------------------------------- recent files

export async function recentList(): Promise<string[]> {
  if (!isTauri()) return ui.recentFiles;
  try {
    ui.recentFiles = await invoke<string[]>("io_recent_list");
  } catch (e) {
    console.warn("[pixelforge] io_recent_list failed", e);
  }
  return ui.recentFiles;
}

export async function recentAdd(path: string): Promise<void> {
  if (!isTauri()) {
    ui.recentFiles = [path, ...ui.recentFiles.filter((p) => p !== path)].slice(0, 20);
    return;
  }
  try {
    ui.recentFiles = await invoke<string[]>("io_recent_add", { path });
  } catch (e) {
    console.warn("[pixelforge] io_recent_add failed", e);
  }
}

export async function recentClear(): Promise<void> {
  if (!isTauri()) {
    ui.recentFiles = [];
    return;
  }
  try {
    ui.recentFiles = await invoke<string[]>("io_recent_remove", { path: null });
  } catch (e) {
    console.warn("[pixelforge] io_recent_remove failed", e);
  }
}
