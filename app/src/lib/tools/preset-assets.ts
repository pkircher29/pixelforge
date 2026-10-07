import { invoke, isTauri } from "@tauri-apps/api/core";
import { Raster } from "$lib/engine";
import { toast } from "$lib/stores/toast.svelte";
import { restorePattern, removePattern, type UserPattern } from "$lib/ui/commands/fill-stroke";
import { restoreBrushTip, removeBrushTip, type BrushTip } from "./brush-tips";
import { brushStore } from "./brush-store.svelte";
import type { BrushPreset } from "./brush-presets";

export type PresetKind = "patterns" | "brushes";
export interface PresetAsset {
  id: string; name: string; width: number; height: number;
  pixels: number[]; settings?: BrushPreset | null;
}
export interface PresetList { assets: PresetAsset[]; errors: string[] }

/** Browser previews use IndexedDB; desktop assets live in the native app-data folders. */
async function browserStore<T>(kind: PresetKind, write: boolean, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pixelforge-presets", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("patterns", { keyPath: "id" });
      request.result.createObjectStore("brushes", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(kind, write ? "readwrite" : "readonly");
      const request = action(transaction.objectStore(kind));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally { db.close(); }
}

export async function listPresetAssets(kind: PresetKind): Promise<PresetList> {
  return isTauri() ? invoke<PresetList>("presets_list", { kind }) : { assets: await browserStore(kind, false, store => store.getAll()), errors: [] };
}
export async function savePresetAsset(kind: PresetKind, asset: PresetAsset): Promise<void> {
  if (isTauri()) await invoke("presets_save", { kind, asset });
  else await browserStore(kind, true, store => store.put(asset));
}
export async function removePresetAsset(kind: PresetKind, id: string): Promise<void> {
  if (isTauri()) await invoke("presets_remove", { kind, id });
  else await browserStore(kind, true, store => store.delete(id));
}

export async function renameUserAsset(kind: PresetKind, asset: PresetAsset, name: string): Promise<void> {
  const next = { ...asset, name, settings: asset.settings ? { ...asset.settings, name } : null };
  await savePresetAsset(kind, next);
  if (kind === "patterns") restorePattern({ id: next.id, name, raster: new Raster(next.width, next.height, new Uint8ClampedArray(next.pixels)) });
  else if (next.settings) { brushStore.restorePreset(next.settings); brushStore.persist(); }
}
export async function deleteUserAsset(kind: PresetKind, asset: PresetAsset): Promise<void> {
  await removePresetAsset(kind, asset.id);
  if (kind === "patterns") removePattern(asset.id);
  else {
    removeBrushTip(asset.id);
    for (const preset of [...brushStore.userPresets]) if (preset.settings.tip === asset.id) brushStore.deletePreset(preset.id);
    if (brushStore.settings.tip === asset.id) brushStore.update({ tip: "round" });
  }
}

export function persistPattern(pattern: UserPattern): Promise<void> {
  return savePresetAsset("patterns", { id: pattern.id, name: pattern.name, width: pattern.raster.width, height: pattern.raster.height, pixels: Array.from(pattern.raster.data) });
}
export function persistBrush(tip: BrushTip, preset: BrushPreset): Promise<void> {
  if (!tip.raster) return Promise.reject(new Error("A sampled brush must contain a tip raster"));
  return savePresetAsset("brushes", { id: tip.id, name: preset.name, width: tip.raster.width, height: tip.raster.height, pixels: Array.from(tip.raster.data), settings: preset });
}

let loading: Promise<void> | null = null;
export function hydratePresetAssets(): Promise<void> {
  return loading ??= (async () => {
    const results = await Promise.all([listPresetAssets("patterns"), listPresetAssets("brushes")]);
    for (const asset of results[0]!.assets) restorePattern({ id: asset.id, name: asset.name, raster: new Raster(asset.width, asset.height, new Uint8ClampedArray(asset.pixels)) });
    for (const asset of results[1]!.assets) {
      restoreBrushTip({ id: asset.id, name: asset.name, kind: "custom", spacing: asset.settings?.settings.spacing ?? 25, raster: new Raster(asset.width, asset.height, new Uint8ClampedArray(asset.pixels)) });
      if (asset.settings) brushStore.restorePreset(asset.settings);
    }
    const errors = results.flatMap(r => r.errors);
    if (errors.length) toast.error("Some presets could not be loaded", errors.join("\n"));
  })().catch(error => { loading = null; throw error; });
}
