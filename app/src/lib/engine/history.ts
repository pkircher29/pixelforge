/**
 * Undo/redo history: a linear list of executed commands with a cursor, capped by a
 * memory budget. Oldest *applied* entries are evicted first (they become permanent);
 * if still over budget, the farthest redo entries are dropped.
 */

import type { Command, Document, HistoryEntry } from "./types";

export interface HistoryOptions {
  /** Max bytes of command snapshots kept. Default 1 GiB (PLAN.md). */
  budgetBytes?: number;
  /** Called after any change (push/undo/redo/jump/eviction/clear). */
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

  /** Bytes currently held by snapshots. */
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
    this.onApply?.(cmd, "undo");
    this.doc.dirty = true;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const cmd = this.list[this.cursor]!.command;
    cmd.do(this.doc);
    this.cursor++;
    this.onApply?.(cmd, "do");
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
      this.onApply?.(cmd, "undo");
    }
    while (this.cursor < target) {
      const cmd = this.list[this.cursor]!.command;
      cmd.do(this.doc);
      this.cursor++;
      this.onApply?.(cmd, "do");
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
    this.emit();
  }

  private evict(): void {
    // Oldest applied entries first: they become permanent.
    while (this.totalBytes > this._budget && this.cursor > 0 && this.list.length > 0) {
      const e = this.list.shift()!;
      this.totalBytes -= e.bytes;
      this.cursor--;
      this._evicted++;
    }
    // Then the farthest redo entries.
    while (this.totalBytes > this._budget && this.list.length > this.cursor) {
      const e = this.list.pop()!;
      this.totalBytes -= e.bytes;
    }
  }

  private emit(): void {
    this.onChange?.(this);
  }
}

function sizeOf(c: Command): number {
  return c.byteSize ? c.byteSize() : 0;
}
