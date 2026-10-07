/**
 * History panel state: options (History Options… dialog, persisted in settings under
 * `historyOptions`), the selected row, snapshot thumbnails (captured at snapshot time,
 * keyed by snapshot id) and the per-document "first snapshot taken" bookkeeping.
 */
import { compositeToRaster, Rect, type HistorySnapshot } from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { settings } from "$lib/stores/settings.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { sampleRaster } from "./thumbnail";

export const HISTORY_OPTIONS_KEY = "historyOptions";

export interface HistoryOptions {
  /** PS "Automatically Create First Snapshot" (default on). */
  autoFirstSnapshot: boolean;
  /** PS "Show New Snapshot Dialog by Default" (default off). */
  showSnapshotDialog: boolean;
  /** PS "Allow Non-Linear History" — not supported (always off). */
  nonLinear: false;
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = { autoFirstSnapshot: true, showSnapshotDialog: false, nonLinear: false };

export type HistorySelection = { kind: "snapshot"; id: string } | { kind: "state"; index: number } | null;

/** Snapshot thumb: 40 px wide box, document aspect, like the Layers "small" thumb. */
export const SNAP_THUMB = { w: 40, h: 28 };

class HistoryUi {
  options = $state<HistoryOptions>({ ...DEFAULT_HISTORY_OPTIONS });
  selected = $state<HistorySelection>(null);
  /** Snapshot id → data URL. */
  thumbs = $state<Record<string, string>>({});
  private hydrated = false;
  private firstDone = new Set<string>();

  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const raw = settings.value[HISTORY_OPTIONS_KEY] as Partial<HistoryOptions> | undefined;
    if (raw && typeof raw === "object") {
      if (typeof raw.autoFirstSnapshot === "boolean") this.options.autoFirstSnapshot = raw.autoFirstSnapshot;
      if (typeof raw.showSnapshotDialog === "boolean") this.options.showSnapshotDialog = raw.showSnapshotDialog;
    }
  }

  setOptions(patch: Partial<Omit<HistoryOptions, "nonLinear">>): void {
    this.options = { ...this.options, ...patch, nonLinear: false };
    void settings.set({ [HISTORY_OPTIONS_KEY]: { autoFirstSnapshot: this.options.autoFirstSnapshot, showSnapshotDialog: this.options.showSnapshotDialog } });
  }

  /** Take the automatic first snapshot once per document (named after the document). */
  ensureFirstSnapshot(entry: OpenDoc): void {
    if (!this.options.autoFirstSnapshot || this.firstDone.has(entry.id)) return;
    this.firstDone.add(entry.id);
    if (entry.history.snapshots.length > 0) return;
    this.takeSnapshot(entry, entry.doc.name);
  }

  /** Capture a snapshot + its thumbnail and bump the document version. */
  takeSnapshot(entry: OpenDoc, name?: string): HistorySnapshot {
    const snap = entry.history.takeSnapshot(name);
    this.thumbs[snap.id] = this.renderThumb(entry);
    entry.version++;
    return snap;
  }

  private renderThumb(entry: OpenDoc): string {
    try {
      const doc = entry.doc;
      const aspect = doc.width / Math.max(1, doc.height);
      let tw = SNAP_THUMB.w;
      let th = Math.round(tw / aspect);
      if (th > SNAP_THUMB.h) {
        th = SNAP_THUMB.h;
        tw = Math.max(8, Math.round(th * aspect));
      }
      const full = compositeToRaster(doc);
      const cv = document.createElement("canvas");
      cv.width = tw;
      cv.height = th;
      const g = cv.getContext("2d");
      if (!g) return "";
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, tw, th);
      g.fillStyle = "#cbcbcb";
      for (let y = 0; y < th; y += 4) for (let x = ((y / 4) & 1) * 4; x < tw; x += 8) g.fillRect(x, y, 4, 4);
      const img = g.createImageData(tw, th);
      sampleRaster(full, { x: 0, y: 0 }, Rect.ofSize(doc.width, doc.height), img.data, tw, th);
      const tmp = document.createElement("canvas");
      tmp.width = tw;
      tmp.height = th;
      tmp.getContext("2d")?.putImageData(img, 0, 0);
      g.drawImage(tmp, 0, 0);
      return cv.toDataURL("image/png");
    } catch {
      return "";
    }
  }

  deleteSnapshot(entry: OpenDoc, id: string): void {
    entry.history.deleteSnapshot(id);
    delete this.thumbs[id];
    if (toolStore.historySource?.kind === "snapshot" && toolStore.historySource.id === id) toolStore.historySource = null;
    if (this.selected?.kind === "snapshot" && this.selected.id === id) this.selected = null;
    entry.version++;
  }

  renameSnapshot(entry: OpenDoc, id: string, name: string): void {
    entry.history.renameSnapshot(id, name);
    entry.version++;
  }

  /** Forget every state (and, since the engine drops snapshots too, re-take the first one). */
  clearHistory(entry: OpenDoc): void {
    entry.history.clear();
    this.thumbs = {};
    this.selected = null;
    toolStore.historySource = null;
    this.firstDone.delete(entry.id);
    entry.version++;
    this.ensureFirstSnapshot(entry);
  }

  /** Jump to a state; bumps the document (the engine's `onChange` is not wired by the store). */
  jumpTo(entry: OpenDoc, index: number): void {
    if (index === entry.history.index) return;
    entry.history.jumpTo(index);
    entry.dirty = true;
    entry.version++;
    entry.pixelVersion++;
    entry.compositor?.invalidateAll();
  }

  restoreSnapshot(entry: OpenDoc, id: string): void {
    if (!entry.history.restoreSnapshot(id)) return;
    entry.compositor?.invalidateAll();
    entry.version++;
    entry.pixelVersion++;
  }

  setSource(src: { kind: "snapshot"; id: string } | { kind: "state"; index: number }): void {
    toolStore.historySource = src;
  }
}

export const historyUi = new HistoryUi();

/** The active document, or null (for the panel ≡ commands). */
export function activeEntry(): OpenDoc | null {
  return docStore.active;
}
