/**
 * Alpha channel, path and quick-mask commands.
 */

import { Raster } from "../raster";
import { addAlphaChannel, findAlphaChannel, removeAlphaChannel } from "../document";
import { enterQuickMask, exitQuickMask } from "../channels";
import type { AlphaChannel, Command, Document, Path, RGBA } from "../types";
import { clonePath } from "../ops/vector";

export class AddAlphaChannelCommand implements Command {
  readonly label = "New Channel";
  readonly channel: AlphaChannel;
  private index: number | undefined;

  constructor(channel: AlphaChannel, index?: number) {
    this.channel = channel;
    this.index = index;
  }

  do(doc: Document): void {
    this.index = addAlphaChannel(doc, this.channel, this.index);
  }

  undo(doc: Document): void {
    removeAlphaChannel(doc, this.channel.id);
  }

  byteSize(): number {
    return this.channel.mask.byteLength();
  }
}

export class RemoveAlphaChannelCommand implements Command {
  readonly label = "Delete Channel";
  readonly channelId: string;
  private removed: { index: number; channel: AlphaChannel } | null = null;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  do(doc: Document): void {
    this.removed = removeAlphaChannel(doc, this.channelId);
  }

  undo(doc: Document): void {
    if (this.removed) addAlphaChannel(doc, this.removed.channel, this.removed.index);
  }

  byteSize(): number {
    return this.removed?.channel.mask.byteLength() ?? 0;
  }
}

export class RenameAlphaChannelCommand implements Command {
  readonly label = "Rename Channel";
  readonly channelId: string;
  private readonly next: string;
  private prev: string | null = null;

  constructor(channelId: string, name: string) {
    this.channelId = channelId;
    this.next = name;
  }

  do(doc: Document): void {
    const c = findAlphaChannel(doc, this.channelId);
    if (!c) return;
    if (this.prev === null) this.prev = c.name;
    c.name = this.next;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const c = findAlphaChannel(doc, this.channelId);
    if (c && this.prev !== null) c.name = this.prev;
    doc.dirty = true;
  }
}

/** Replace a channel's mask raster and/or overlay colour / opacity. */
export class SetAlphaChannelCommand implements Command {
  readonly label: string;
  readonly channelId: string;
  private readonly next: { mask?: Raster; color?: RGBA; opacity?: number };
  private prev: { mask: Raster; color: RGBA; opacity: number } | null = null;

  constructor(channelId: string, next: { mask?: Raster; color?: RGBA; opacity?: number }, label = "Channel Options") {
    this.channelId = channelId;
    this.next = next;
    this.label = label;
  }

  do(doc: Document): void {
    const c = findAlphaChannel(doc, this.channelId);
    if (!c) return;
    if (!this.prev) this.prev = { mask: c.mask, color: { ...c.color }, opacity: c.opacity };
    if (this.next.mask) c.mask = this.next.mask;
    if (this.next.color) c.color = { ...this.next.color };
    if (this.next.opacity !== undefined) c.opacity = this.next.opacity;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    const c = findAlphaChannel(doc, this.channelId);
    if (!c || !this.prev) return;
    c.mask = this.prev.mask;
    c.color = { ...this.prev.color };
    c.opacity = this.prev.opacity;
    doc.dirty = true;
  }

  byteSize(): number {
    return (this.next.mask?.byteLength() ?? 0) + (this.prev?.mask.byteLength() ?? 0);
  }
}

/** Replace the document's paths (and work path id). Paths are deep-copied on both sides. */
export class SetPathsCommand implements Command {
  readonly label: string;
  private readonly next: { paths: Path[]; workPathId: string | null };
  private prev: { paths: Path[]; workPathId: string | null } | null = null;

  constructor(paths: readonly Path[], workPathId: string | null, label = "Edit Path") {
    this.next = { paths: paths.map(clonePath), workPathId };
    this.label = label;
  }

  do(doc: Document): void {
    if (!this.prev) this.prev = { paths: doc.paths.map(clonePath), workPathId: doc.workPathId };
    doc.paths = this.next.paths.map(clonePath);
    doc.workPathId = this.next.workPathId;
    doc.dirty = true;
  }

  undo(doc: Document): void {
    if (!this.prev) return;
    doc.paths = this.prev.paths.map(clonePath);
    doc.workPathId = this.prev.workPathId;
    doc.dirty = true;
  }
}

/** Replace one path (by id) or add it when new. */
export function setPathCommand(doc: Document, path: Path, label = "Edit Path"): SetPathsCommand {
  const i = doc.paths.findIndex((p) => p.id === path.id);
  const next = doc.paths.slice();
  if (i >= 0) next[i] = path;
  else next.push(path);
  return new SetPathsCommand(next, doc.workPathId ?? (i < 0 ? path.id : null), label);
}

/** Toggle Quick Mask mode (Q). Entering converts the selection to the mask raster and back on exit. */
export class ToggleQuickMaskCommand implements Command {
  readonly label: string;
  private readonly enter: boolean;
  private prevSelection: Document["selection"] | null = null;
  private prevRaster: Raster | null = null;

  constructor(enter: boolean) {
    this.enter = enter;
    this.label = enter ? "Enter Quick Mask" : "Exit Quick Mask";
  }

  do(doc: Document): void {
    this.prevSelection = doc.selection;
    this.prevRaster = doc.quickMask.raster;
    if (this.enter) enterQuickMask(doc);
    else exitQuickMask(doc);
  }

  undo(doc: Document): void {
    doc.quickMask.active = !this.enter;
    doc.quickMask.raster = this.prevRaster;
    if (this.prevSelection) doc.selection = this.prevSelection;
    doc.dirty = true;
  }
}
