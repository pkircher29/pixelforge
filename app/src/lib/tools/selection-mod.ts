/**
 * Selection-tool helpers shared by marquee, lasso and wand: modifier→mode mapping,
 * drag-rect constraints and combining a new shape with the existing selection.
 */
import { Rect, Selection, type Point } from "$lib/engine";
import type { SelectionMode } from "./types";

/** Photoshop: Shift = add, Alt = subtract, Shift+Alt = intersect. `base` is the options-bar mode. */
export function modeFromModifiers(mods: { shiftKey: boolean; altKey: boolean }, base: SelectionMode = "new"): SelectionMode {
  if (mods.shiftKey && mods.altKey) return "intersect";
  if (mods.shiftKey) return "add";
  if (mods.altKey) return "subtract";
  return base;
}

/**
 * Rectangle from a drag. `square` constrains to 1:1 (Shift after the drag started);
 * `fromCenter` grows around the anchor (Alt after the drag started).
 */
export function dragRect(anchor: Point, cur: Point, opts: { square?: boolean; fromCenter?: boolean } = {}): Rect {
  let dx = cur.x - anchor.x;
  let dy = cur.y - anchor.y;
  if (opts.square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  if (opts.fromCenter) {
    return Rect.make(anchor.x - Math.abs(dx), anchor.y - Math.abs(dy), Math.abs(dx) * 2, Math.abs(dy) * 2);
  }
  return Rect.fromPoints(anchor, { x: anchor.x + dx, y: anchor.y + dy });
}

/** Combine per `mode`; `existing` may be empty (then add/intersect behave like new). */
export function combineSelection(existing: Selection, next: Selection, mode: SelectionMode): Selection {
  switch (mode) {
    case "add":
      return existing.isEmpty ? next : existing.add(next);
    case "subtract":
      return existing.isEmpty ? existing : existing.subtract(next);
    case "intersect":
      return existing.isEmpty ? next : existing.intersect(next);
    default:
      return next;
  }
}

/** Apply optional feathering (px) to a freshly made shape. */
export function featherIf(sel: Selection, feather: number): Selection {
  return feather > 0 ? sel.feather(feather) : sel;
}

/** A drag shorter than this (doc px / zoom) counts as a click. */
export function isClick(a: Point, b: Point, zoom: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) * zoom < 3;
}

/** Label for the history panel. */
export function selectionLabel(kind: string, mode: SelectionMode): string {
  const verb = mode === "add" ? "Add to" : mode === "subtract" ? "Subtract from" : mode === "intersect" ? "Intersect" : "";
  return verb ? `${verb} Selection (${kind})` : `${kind} Select`;
}
