/**
 * Swatches import / export (Pixelforge `.json` only — ASE / ACO are not supported and
 * the file filters say so). Tauri: native pickers + plugin-fs; browser preview: a
 * download link and a transient `<input type=file>`.
 */
import { isTauri } from "@tauri-apps/api/core";
import { open as pickOpen, save as pickSave } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast, errorMessage } from "$lib/stores/toast.svelte";
import { parseSwatches, swatchStore } from "./Swatches.store.svelte";

export async function exportSwatches(): Promise<void> {
  const json = swatchStore.exportJson();
  try {
    if (isTauri()) {
      const path = await pickSave({ defaultPath: "swatches.json", filters: [{ name: "Pixelforge swatches (.json)", extensions: ["json"] }] });
      if (!path) return;
      await writeTextFile(path, json);
      toast.success("Swatches exported", path);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = "swatches.json";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (e) {
    toast.error("Export failed", errorMessage(e));
  }
}

/** Parse + merge a swatch file's text. Returns the number of colors added, or -1 on a bad file. */
export function importSwatchText(text: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    toast.error("Import failed", "Not a JSON swatch file. ASE and ACO files are not supported.");
    return -1;
  }
  const set = parseSwatches(parsed);
  if (!set) {
    toast.error("Import failed", "Not a Pixelforge swatch file.");
    return -1;
  }
  swatchStore.importSet(set, true);
  const n = set.items.length + set.groups.reduce((k, g) => k + g.swatches.length, 0);
  toast.success("Swatches imported", `${n} color${n === 1 ? "" : "s"}`);
  return n;
}

export async function importSwatches(): Promise<void> {
  try {
    if (isTauri()) {
      const path = await pickOpen({ multiple: false, filters: [{ name: "Pixelforge swatches (.json) — ASE/ACO not supported", extensions: ["json"] }] });
      if (!path || Array.isArray(path)) return;
      importSwatchText(await readTextFile(path));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) importSwatchText(await f.text());
    };
    input.click();
  } catch (e) {
    toast.error("Import failed", errorMessage(e));
  }
}
