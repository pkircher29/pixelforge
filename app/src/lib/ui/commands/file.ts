/** File menu. */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { toast, errorMessage } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { registerCommand, registerCommands, type CommandDef } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import NewDocDialog, { type NewDocResult } from "../dialogs/NewDocDialog.svelte";
import ExportDialog, { type ExportResult } from "../dialogs/ExportDialog.svelte";
import ConfirmDialog from "../dialogs/ConfirmDialog.svelte";
import PreferencesDialog from "../dialogs/PreferencesDialog.svelte";
import { exportComposite, openFile, pickOpenPaths, pickSavePath, recentClear, saveProject } from "$lib/io/files";
import { extensionOf } from "$lib/io/convert";
import { canvasHost } from "../canvas/host.svelte";

export function nextUntitledName(): string {
  const used = new Set(docStore.docs.map((d) => d.doc.name));
  let n = 1;
  while (used.has(`Untitled-${n}`)) n++;
  return `Untitled-${n}`;
}

export async function newDocument(): Promise<void> {
  const r = await openDialog<{ defaultName: string }, NewDocResult>(NewDocDialog, { defaultName: nextUntitledName() });
  if (!r) return;
  try {
    const entry = docStore.create({ name: r.name, width: r.width, height: r.height, background: r.background, dpi: r.dpi });
    entry.dirty = false;
    entry.doc.dirty = false;
  } catch (e) {
    toast.error("Couldn't create the document", errorMessage(e));
  }
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    // Already open? Just switch to it.
    const existing = docStore.docs.find((d) => d.path && d.path.toLowerCase() === p.toLowerCase());
    if (existing) {
      docStore.activate(existing.id);
      continue;
    }
    try {
      const t0 = performance.now();
      const entry = await openFile(p);
      const ms = Math.round(performance.now() - t0);
      toast.success(`Opened ${entry.doc.name}`, `${entry.doc.width} × ${entry.doc.height}, ${entry.doc.layers.length} layer${entry.doc.layers.length === 1 ? "" : "s"} · ${ms} ms`);
    } catch (e) {
      toast.error(`Couldn't open ${p.split(/[\\/]/).pop()}`, errorMessage(e));
    }
  }
}

export async function openDocumentDialog(): Promise<void> {
  try {
    const paths = await pickOpenPaths();
    if (paths) await openPaths(paths);
  } catch (e) {
    toast.error("Open failed", errorMessage(e));
  }
}

export async function saveDocument(entry: OpenDoc, forceAs = false): Promise<boolean> {
  try {
    let path = entry.path;
    if (forceAs || !path || extensionOf(path) !== "pfproj") {
      path = await pickSavePath(entry.doc.name, "pfproj");
      if (!path) return false;
    }
    await saveProject(entry, path);
    toast.success(`Saved ${entry.doc.name}`, path);
    return true;
  } catch (e) {
    toast.error("Save failed", errorMessage(e));
    return false;
  }
}

export async function exportDocument(entry: OpenDoc): Promise<void> {
  const r = await openDialog<{ width: number; height: number }, ExportResult>(ExportDialog, { width: entry.doc.width, height: entry.doc.height });
  if (!r) return;
  try {
    const path = await pickSavePath(entry.doc.name, r.format);
    if (!path) return;
    const bytes = await exportComposite(entry.doc, path, r.format, r.opts);
    toast.success(`Exported ${r.format.toUpperCase()}`, `${path} · ${(bytes / 1024).toFixed(0)} KB`);
  } catch (e) {
    toast.error("Export failed", errorMessage(e));
  }
}

/** Close with a save prompt when dirty. Resolves true when closed. */
export async function closeDocument(id: string): Promise<boolean> {
  const entry = docStore.get(id);
  if (!entry) return true;
  if (entry.dirty) {
    docStore.activate(id);
    const r = await openDialog<{ title: string; message: string; buttons: { label: string; value: string; primary?: boolean; danger?: boolean }[] }, string>(ConfirmDialog, {
      title: `Close ${entry.doc.name}?`,
      message: "There are unsaved changes. Save them before closing?",
      buttons: [
        { label: "Don't save", value: "discard", danger: true },
        { label: "Cancel", value: "cancel" },
        { label: "Save", value: "save", primary: true },
      ],
    });
    if (!r || r === "cancel") return false;
    if (r === "save" && !(await saveDocument(entry))) return false;
  }
  canvasHost.cancelTool();
  docStore.close(id);
  return true;
}

export async function closeAll(): Promise<boolean> {
  for (const d of [...docStore.docs]) {
    if (!(await closeDocument(d.id))) return false;
  }
  return true;
}

export async function quit(): Promise<void> {
  if (!(await closeAll())) return;
  if (isTauri()) await getCurrentWindow().close();
}

const RECENT_MAX = 10;

/** Re-register `File/Open Recent` items from `ui.recentFiles` (called from an effect). */
export function syncRecentCommands(paths: readonly string[]): void {
  for (let i = 0; i < RECENT_MAX; i++) {
    const p = paths[i];
    if (!p) {
      // Slot 0 stays in the menu as a disabled "No recent files" row; others vanish.
      const def: CommandDef = { id: `file.recent.${i}`, label: "No recent files", order: 100 + i, enabled: () => false, run: () => {} };
      if (i === 0) def.menu = "File/Open Recent";
      registerCommand(def);
      continue;
    }
    const name = p.split(/[\\/]/).pop() ?? p;
    registerCommand({ id: `file.recent.${i}`, label: `${i + 1}. ${name}`, menu: "File/Open Recent", order: 100 + i, keywords: [p, "recent"], run: () => openPaths([p]) });
  }
}

registerCommands([
  { id: "file.new", label: "New…", menu: "File", order: 100, shortcut: "CmdOrCtrl+N", keywords: ["create", "document"], run: newDocument },
  { id: "file.open", label: "Open…", menu: "File", order: 101, shortcut: "CmdOrCtrl+O", keywords: ["load", "image", "psd", "project"], run: openDocumentDialog },
  { id: "file.recent.clear", label: "Clear recent", menu: "File/Open Recent", order: 190, enabled: () => ui.recentFiles.length > 0, run: () => recentClear() },
  { id: "file.close", label: "Close", menu: "File", order: 103, shortcut: "CmdOrCtrl+W", enabled: () => !!docStore.active, run: async () => { if (docStore.activeId) await closeDocument(docStore.activeId); } },
  { id: "file.closeAll", label: "Close all", menu: "File", order: 104, shortcut: "CmdOrCtrl+Alt+W", enabled: () => docStore.docs.length > 0, run: async () => { await closeAll(); } },
  { id: "file.save", label: "Save", menu: "File", order: 200, shortcut: "CmdOrCtrl+S", keywords: ["pfproj", "project"], enabled: () => !!docStore.active, run: async () => { if (docStore.active) await saveDocument(docStore.active); } },
  { id: "file.saveAs", label: "Save as…", menu: "File", order: 201, shortcut: "CmdOrCtrl+Shift+S", enabled: () => !!docStore.active, run: async () => { if (docStore.active) await saveDocument(docStore.active, true); } },
  { id: "file.export", label: "Export as…", menu: "File", order: 202, shortcut: "CmdOrCtrl+Shift+E", keywords: ["png", "jpeg", "jpg", "webp", "save image"], enabled: () => !!docStore.active, run: async () => { if (docStore.active) await exportDocument(docStore.active); } },
  { id: "file.preferences", label: "Preferences…", menu: "File", order: 300, shortcut: "CmdOrCtrl+,", keywords: ["settings", "options"], run: async () => { await openDialog<Record<string, never>, void>(PreferencesDialog, {}); } },
  { id: "file.quit", label: "Quit", menu: "File", order: 400, shortcut: "CmdOrCtrl+Q", keywords: ["exit"], run: quit },
]);
