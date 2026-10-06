/**
 * Undo/redo history: a linear list of executed commands with a cursor, capped by a
 * memory budget. Oldest *applied* entries are evicted first (they become permanent);
 * if still over budget, the farthest redo entries are dropped.
 *
 * v2 adds **snapshots** (History panel camera button): full, independent copies of the
 * document that can be restored as an undoable step, and the History Brush source
 * helpers `rasterAt` / `rasterFromSource`.
 */

import { Raster } from "./raster";
import { findLayer } from "./document";
import { captureDocState, restoreDocState, stateLayerRaster, type DocState } from "./snapshot";
import type { Command, Document, HistoryEntry, HistorySnapshot, HistorySource, LayerId } from "./types";

export interface HistoryOptions {
  /** Max bytes of command snapshots kept. Default 1 GiB (PLAN.md). */
  budgetBytes?: number;
  /** Called after any change (push/undo/redo/jump/eviction/clear/snapshots). */
  onChange?: (history: History) => void;
  /**
   * Called after each command application (`"do"` for push/redo/jump-forward, `"undo"`
   * for undo/jump-back). The natural place to forward `command.affected()` to the
   * compositor's `markDirty`.
   */
  onApply?: (command: Command, direction: "do" | "undo") => void;
}

export interface PushOptions {
  /**
   * The command's effect is already applied to the document (e.g. a paint stroke that
   * drew directly into the layer); skip calling `do`.
   */
  alreadyApplied?: boolean;
  /** Disallow merging into the previous entry even if `mergeWith` would accept. */
  noMerge?: boolean;
}

export const DEFAULT_HISTORY_BUDGET = 1024 * 1024 * 1024;

interface SnapshotEntry extends HistorySnapshot {
  state: DocState;
}

/** Undoable "restore snapshot" step (History panel click on a snapshot). */
export class SnapshotCommand implements Command {
  readonly label: string;
  private readonly target: DocState;
  private before: DocState | null = null;

  constructor(target: DocState, label = "Restore Snapshot") {
    this.target = target;
    this.label = label;
  }

  do(doc: Document): void {
    if (!this.before) this.before = captureDocState(doc);
    restoreDocState(doc, this.target);
  }

  undo(doc: Document): void {
    if (this.before) restoreDocState(doc, this.before);
  }

  byteSize(): number {
    return (this.before?.bytes ?? 0) + this.target.bytes;
  }
}

let snapCounter = 0;

export class History {
  readonly doc: Document;
  private list: HistoryEntry[] = [];
  /** Number of applied entries; `list[index-1]` is the most recent applied one. */
  private cursor = 0;
  private totalBytes = 0;
  private seq = 0;
  private _budget: number;
  private readonly onChange: ((h: History) => void) | undefined;
  private readonly onApply: ((c: Command, d: "do" | "undo") => void) | undefined;
  /** Count of entries evicted from the bottom (so the panel can show "... N older"). */
  private _evicted = 0;
  private snaps: SnapshotEntry[] = [];
  private silent = 0;

  constructor(doc: Document, opts: HistoryOptions = {}) {
    this.doc = doc;
    this._budget = opts.budgetBytes ?? DEFAULT_HISTORY_BUDGET;
    this.onChange = opts.onChange;
    this.onApply = opts.onApply;
  }

  /** Read-only view of the entries (oldest first). */
  get entries(): readonly HistoryEntry[] {
    return this.list;
  }

  /** Current cursor: number of applied entries (0..entries.length). */
  get index(): number {
    return this.cursor;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.list.length;
  }

  /** Bytes currently held by command snapshots (history snapshots are counted separately: `snapshotBytes`). */
  get bytes(): number {
    return this.totalBytes;
  }

  get budgetBytes(): number {
    return this._budget;
  }

  set budgetBytes(v: number) {
    this._budget = Math.max(0, v);
    this.evict();
    this.emit();
  }

  get evictedCount(): number {
    return this._evicted;
  }

  /** Label of the command that `undo()` would revert, or `null`. */
  get undoLabel(): string | null {
    return this.cursor > 0 ? this.list[this.cursor - 1]!.label : null;
  }

  /** Label of the command that `redo()` would re-apply, or `null`. */
  get redoLabel(): string | null {
    return this.cursor < this.list.length ? this.list[this.cursor]!.label : null;
  }

  /**
   * Execute (unless `alreadyApplied`) and record a command. Any redo entries are
   * discarded. If the previous entry's `mergeWith` accepts the new command, the two are
   * coalesced into one entry.
   */
  push(command: Command, opts: PushOptions = {}): void {
    if (!opts.alreadyApplied) command.do(this.doc);
    this.onApply?.(command, "do");
    this.doc.dirty = true;
    // Drop redo tail.
    if (this.cursor < this.list.length) {
      for (let i = this.cursor; i < this.list.length; i++) this.totalBytes -= this.list[i]!.bytes;
      this.list.length = this.cursor;
      for (const s of this.snaps) if (s.historyIndex > this.cursor) s.historyIndex = this.cursor;
    }
    const prev = this.list[this.cursor - 1];
    if (!opts.noMerge && prev && prev.command.mergeWith && prev.command.mergeWith(command)) {
      const newBytes = sizeOf(prev.command);
      this.totalBytes += newBytes - prev.bytes;
      this.list[this.cursor - 1] = { ...prev, bytes: newBytes };
    } else {
      const bytes = sizeOf(command);
      this.list.push({ label: command.label, command, bytes, seq: this.seq++ });
      this.cursor++;
      this.totalBytes += bytes;
    }
    this.evict();
    this.emit();
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    this.cursor--;
    const cmd = this.list[this.cursor]!.command;
    cmd.undo(this.doc);
    this.notifyApply(cmd, "undo");
    this.doc.dirty = true;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const cmd = this.list[this.cursor]!.command;
    cmd.do(this.doc);
    this.cursor++;
    this.notifyApply(cmd, "do");
    this.doc.dirty = true;
    this.emit();
    return true;
  }

  /** Undo/redo until exactly `index` entries are applied (History panel click). */
  jumpTo(index: number): void {
    const target = Math.max(0, Math.min(this.list.length, index));
    if (target === this.cursor) return;
    while (this.cursor > target) {
      this.cursor--;
      const cmd = this.list[this.cursor]!.command;
      cmd.undo(this.doc);
      this.notifyApply(cmd, "undo");
    }
    while (this.cursor < target) {
      const cmd = this.list[this.cursor]!.command;
      cmd.do(this.doc);
      this.cursor++;
      this.notifyApply(cmd, "do");
    }
    this.doc.dirty = true;
    this.emit();
  }

  /** Forget everything (e.g. after save-as of a new document). The document is untouched. */
  clear(): void {
    this.list = [];
    this.cursor = 0;
    this.totalBytes = 0;
    this._evicted = 0;
    this.snaps = [];
    this.emit();
  }

  // ------------------------------------------------------------------ snapshots

  /** Snapshots in creation order. */
  get snapshots(): readonly HistorySnapshot[] {
    return this.snaps;
  }

  /** Bytes held by history snapshots (not counted against `budgetBytes`). */
  get snapshotBytes(): number {
    return this.snaps.reduce((n, s) => n + s.bytes, 0);
  }

  /** Capture the whole document as a named snapshot (History panel camera). */
  takeSnapshot(name?: string): HistorySnapshot {
    snapCounter++;
    const state = captureDocState(this.doc);
    const snap: SnapshotEntry = {
      id: `snap_${Date.now().toString(36)}_${snapCounter}`,
      name: name ?? `Snapshot ${this.snaps.length + 1}`,
      historyIndex: this.cursor,
      bytes: state.bytes,
      createdAt: Date.now(),
      state,
    };
    this.snaps.push(snap);
    this.emit();
    return snap;
  }

  /** Restore a snapshot as an undoable step. Returns false for unknown ids. */
  restoreSnapshot(id: string): boolean {
    const s = this.snaps.find((x) => x.id === id);
    if (!s) return false;
    this.push(new SnapshotCommand(s.state, `Restore "${s.name}"`), { noMerge: true });
    return true;
  }

  deleteSnapshot(id: string): boolean {
    const i = this.snaps.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.snaps.splice(i, 1);
    this.emit();
    return true;
  }

  renameSnapshot(id: string, name: string): boolean {
    const s = this.snaps.find((x) => x.id === id);
    if (!s) return false;
    s.name = name;
    this.emit();
    return true;
  }

  /** A snapshot's copy of a layer's pixels (cloned), or null. */
  snapshotRaster(id: string, layerId: LayerId): Raster | null {
    const s = this.snaps.find((x) => x.id === id);
    return s ? stateLayerRaster(s.state, layerId) : null;
  }

  /**
   * History Brush source: the pixels of `layerId` as they were when exactly `index`
   * entries were applied (`History.index` semantics; today's state for `index ===
   * this.index`).
   *
   * Complexity: O(1) when a snapshot was taken at that index (its copy is returned);
   * otherwise the live history is silently jumped to `index` (replaying the real
   * commands — O(|index − cursor|) command applications, each undoing / redoing its own
   * dirty rects), the raster is cloned and the history is jumped back. Observers
   * (`onChange` / `onApply`) are not notified during the excursion, and the document
   * is left exactly as before. Returns null when the layer does not exist at that
   * state.
   */
  rasterAt(index: number, layerId: LayerId): Raster | null {
    const target = Math.max(0, Math.min(this.list.length, index));
    const snap = this.snaps.find((s) => s.historyIndex === target);
    if (snap) return stateLayerRaster(snap.state, layerId);
    if (target === this.cursor) return cloneLayerRaster(this.doc, layerId);
    const back = this.cursor;
    const wasDirty = this.doc.dirty;
    this.silent++;
    try {
      this.jumpTo(target);
      const r = cloneLayerRaster(this.doc, layerId);
      this.jumpTo(back);
      return r;
    } finally {
      this.silent--;
      this.doc.dirty = wasDirty;
    }
  }

  /** `rasterAt` / `snapshotRaster` by a `HistorySource`. */
  rasterFromSource(source: HistorySource, layerId: LayerId): Raster | null {
    return source.kind === "snapshot" ? this.snapshotRaster(source.id, layerId) : this.rasterAt(source.index, layerId);
  }

  // ------------------------------------------------------------------ internals

  private notifyApply(cmd: Command, dir: "do" | "undo"): void {
    if (this.silent === 0) this.onApply?.(cmd, dir);
  }

  private evict(): void {
    // Oldest applied entries first: they become permanent.
    while (this.totalBytes > this._budget && this.cursor > 0 && this.list.length > 0) {
      const e = this.list.shift()!;
      this.totalBytes -= e.bytes;
      this.cursor--;
      this._evicted++;
      for (const s of this.snaps) s.historyIndex = Math.max(0, s.historyIndex - 1);
    }
    // Then the farthest redo entries.
    while (this.totalBytes > this._budget && this.list.length > this.cursor) {
      const e = this.list.pop()!;
      this.totalBytes -= e.bytes;
    }
  }

  private emit(): void {
    if (this.silent === 0) this.onChange?.(this);
  }
}

function cloneLayerRaster(doc: Document, layerId: LayerId): Raster | null {
  const l = findLayer(doc, layerId);
  if (!l || !(l.kind === "raster" || l.kind === "shape" || l.kind === "text")) return null;
  return l.raster.clone();
}

function sizeOf(c: Command): number {
  return c.byteSize ? c.byteSize() : 0;
}
