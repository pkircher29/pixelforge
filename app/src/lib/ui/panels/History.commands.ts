/**
 * History panel commands (`history.*`): camera / snapshot dialog, delete, clear, new
 * document from the current state, History Options…. Registered at import; the panel
 * ≡ menu and the bottom bar proxy to these.
 */
import { captureDocState, createDocument, restoreDocState } from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import HistoryOptionsDialog from "./HistoryOptionsDialog.svelte";
import HistorySnapshotDialog from "./HistorySnapshotDialog.svelte";
import { historyUi } from "./History.store.svelte";

type NameProps = { title: string; label: string; initial: string; okLabel: string; from?: boolean };

export async function newSnapshot(entry: OpenDoc, ask: boolean): Promise<void> {
  const initial = `Snapshot ${entry.history.snapshots.length + 1}`;
  if (!ask) {
    historyUi.takeSnapshot(entry, initial);
    return;
  }
  const name = await openDialog<NameProps, string>(HistorySnapshotDialog, { title: "New Snapshot", label: "Name:", initial, okLabel: "OK", from: true });
  if (name !== null) historyUi.takeSnapshot(entry, name);
}

/** Camera button: PS takes a snapshot straight away; Alt-click (or the option) asks for a name. */
export function cameraClick(entry: OpenDoc, alt: boolean): void {
  void newSnapshot(entry, alt || historyUi.options.showSnapshotDialog);
}

export function deleteSelected(entry: OpenDoc): void {
  const sel = historyUi.selected;
  if (!sel) return;
  if (sel.kind === "snapshot") historyUi.deleteSnapshot(entry, sel.id);
  else if (sel.index > 0) {
    // The engine has no "truncate" — deleting a state steps back to the one before it;
    // the deleted states stay reachable with Step Forward until the next edit.
    historyUi.jumpTo(entry, sel.index - 1);
    historyUi.selected = null;
  }
}

/** New Document from the current state: a deep copy named after the state. */
export function newDocumentFromState(entry: OpenDoc): OpenDoc {
  const state = captureDocState(entry.doc);
  const doc = createDocument({ width: entry.doc.width, height: entry.doc.height, noBackgroundLayer: true, dpi: entry.doc.meta.dpi });
  restoreDocState(doc, state);
  doc.name = entry.history.undoLabel ?? entry.doc.name;
  doc.dirty = false;
  const opened = docStore.open(doc, null);
  opened.dirty = false;
  return opened;
}

const active = (): OpenDoc | null => docStore.active;

registerCommands([
  { id: "history.takeSnapshot", label: "New Snapshot…", keywords: ["history", "camera"], enabled: () => !!active(), run: () => { const e = active(); if (e) void newSnapshot(e, true); } },
  { id: "history.delete", label: "Delete", keywords: ["history state", "snapshot"], enabled: () => !!active() && historyUi.selected !== null && !(historyUi.selected.kind === "state" && historyUi.selected.index === 0), run: () => { const e = active(); if (e) deleteSelected(e); } },
  { id: "history.clear", label: "Clear History", keywords: ["purge", "undo"], enabled: () => !!active() && (active()!.history.entries.length > 0), run: () => { const e = active(); if (e) { historyUi.clearHistory(e); toast.info("History cleared."); } } },
  { id: "history.newDocument", label: "New Document", keywords: ["from current state", "duplicate"], enabled: () => !!active(), run: () => { const e = active(); if (e) newDocumentFromState(e); } },
  { id: "history.options", label: "History Options…", keywords: ["snapshot", "non-linear"], run: async () => { await openDialog<Record<string, never>, void>(HistoryOptionsDialog, {}); } },
]);
