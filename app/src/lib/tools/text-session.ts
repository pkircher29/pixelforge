/**
 * Pure text-editing model for the Type tool: text + caret + selection anchor with
 * insert / delete / caret movement in multi-line text. Indices are UTF-16 offsets.
 */

export interface TextModel {
  text: string;
  /** Caret position (end of the selection that moves). */
  caret: number;
  /** Selection anchor; equal to `caret` when nothing is selected. */
  anchor: number;
}

export function emptyModel(text = ""): TextModel {
  return { text, caret: text.length, anchor: text.length };
}

export function selectionRange(m: TextModel): { start: number; end: number } {
  return { start: Math.min(m.caret, m.anchor), end: Math.max(m.caret, m.anchor) };
}

export function hasSelection(m: TextModel): boolean {
  return m.caret !== m.anchor;
}

export function selectedText(m: TextModel): string {
  const { start, end } = selectionRange(m);
  return m.text.slice(start, end);
}

/** Replace the selection (or insert at the caret) with `s`. */
export function insertText(m: TextModel, s: string): TextModel {
  const { start, end } = selectionRange(m);
  const text = m.text.slice(0, start) + s + m.text.slice(end);
  const caret = start + s.length;
  return { text, caret, anchor: caret };
}

/** Backspace: delete the selection, else the character before the caret. */
export function deleteBackward(m: TextModel): TextModel {
  if (hasSelection(m)) return insertText(m, "");
  if (m.caret === 0) return m;
  const prev = prevIndex(m.text, m.caret);
  const text = m.text.slice(0, prev) + m.text.slice(m.caret);
  return { text, caret: prev, anchor: prev };
}

/** Delete: delete the selection, else the character after the caret. */
export function deleteForward(m: TextModel): TextModel {
  if (hasSelection(m)) return insertText(m, "");
  if (m.caret >= m.text.length) return m;
  const next = nextIndex(m.text, m.caret);
  const text = m.text.slice(0, m.caret) + m.text.slice(next);
  return { text, caret: m.caret, anchor: m.caret };
}

/** Index of the previous code point boundary (surrogate-pair aware). */
export function prevIndex(text: string, i: number): number {
  if (i <= 0) return 0;
  const c = text.charCodeAt(i - 1);
  return c >= 0xdc00 && c <= 0xdfff && i >= 2 ? i - 2 : i - 1;
}

export function nextIndex(text: string, i: number): number {
  if (i >= text.length) return text.length;
  const c = text.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? i + 2 : i + 1;
}

export interface LinePos {
  line: number;
  col: number;
}

/** Lines of the text. */
export function lines(text: string): string[] {
  return text.split("\n");
}

/** (line, column) of an index. */
export function linePosOf(text: string, index: number): LinePos {
  const i = Math.max(0, Math.min(text.length, index));
  const before = text.slice(0, i);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNl = before.lastIndexOf("\n");
  return { line, col: i - (lastNl + 1) };
}

/** Index of (line, column), clamping the column to the line length. */
export function indexAt(text: string, line: number, col: number): number {
  const ls = lines(text);
  const l = Math.max(0, Math.min(ls.length - 1, line));
  let idx = 0;
  for (let i = 0; i < l; i++) idx += ls[i]!.length + 1;
  return idx + Math.max(0, Math.min(ls[l]!.length, col));
}

export type CaretMove = "left" | "right" | "up" | "down" | "home" | "end" | "docStart" | "docEnd";

/** Move the caret; `extend` keeps the anchor (Shift). Collapsing a selection with ←/→ jumps to its edge. */
export function moveCaret(m: TextModel, dir: CaretMove, extend = false): TextModel {
  const { start, end } = selectionRange(m);
  let caret = m.caret;
  if (!extend && hasSelection(m) && (dir === "left" || dir === "right")) {
    caret = dir === "left" ? start : end;
    return { ...m, caret, anchor: caret };
  }
  const pos = linePosOf(m.text, caret);
  switch (dir) {
    case "left":
      caret = prevIndex(m.text, caret);
      break;
    case "right":
      caret = nextIndex(m.text, caret);
      break;
    case "up":
      caret = pos.line === 0 ? 0 : indexAt(m.text, pos.line - 1, pos.col);
      break;
    case "down": {
      const n = lines(m.text).length;
      caret = pos.line >= n - 1 ? m.text.length : indexAt(m.text, pos.line + 1, pos.col);
      break;
    }
    case "home":
      caret = indexAt(m.text, pos.line, 0);
      break;
    case "end":
      caret = indexAt(m.text, pos.line, Infinity);
      break;
    case "docStart":
      caret = 0;
      break;
    case "docEnd":
      caret = m.text.length;
      break;
  }
  return { text: m.text, caret, anchor: extend ? m.anchor : caret };
}

export function selectAll(m: TextModel): TextModel {
  return { text: m.text, caret: m.text.length, anchor: 0 };
}

/** Set caret/anchor from a textarea's selectionStart/End + direction. */
export function fromTextarea(text: string, start: number, end: number, direction: "forward" | "backward" | "none" = "forward"): TextModel {
  return direction === "backward" ? { text, caret: start, anchor: end } : { text, caret: end, anchor: start };
}

/** Selection rectangles per line: `[line, colStart, colEnd]` for drawing highlights. */
export function selectionSpans(m: TextModel): { line: number; start: number; end: number }[] {
  const { start, end } = selectionRange(m);
  if (start === end) return [];
  const a = linePosOf(m.text, start);
  const b = linePosOf(m.text, end);
  const ls = lines(m.text);
  const out: { line: number; start: number; end: number }[] = [];
  for (let l = a.line; l <= b.line; l++) {
    const s = l === a.line ? a.col : 0;
    const e = l === b.line ? b.col : ls[l]!.length;
    out.push({ line: l, start: s, end: e });
  }
  return out;
}
