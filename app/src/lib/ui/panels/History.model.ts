/**
 * History panel row model (pure): snapshot rows at the top, then one row per history
 * state with the History Brush source column, the current state and the greyed
 * (undone) states after it. Tested in `tests/panels/history.test.ts`.
 */
import type { HistorySource } from "$lib/engine";

export interface HistoryInput {
  /** Applied + undone entries, oldest first (`History.entries`). */
  entries: readonly { label: string; seq: number }[];
  /** `History.index`: number of applied entries. */
  index: number;
  snapshots: readonly { id: string; name: string; historyIndex: number }[];
  source: HistorySource | null;
  /** Document opened from a file (first state reads "Open") or created ("New"). */
  opened: boolean;
  evicted: number;
}

export interface SnapshotRow {
  kind: "snapshot";
  id: string;
  name: string;
  /** The history brush reads from this snapshot. */
  isSource: boolean;
  /** Taken at the current state (PS highlights the matching state, not the snapshot). */
  atCurrent: boolean;
}

export interface StateRow {
  kind: "state";
  /** `History.index` value this row restores. */
  index: number;
  label: string;
  current: boolean;
  /** After the current state: greyed, click to redo-jump. */
  undone: boolean;
  isSource: boolean;
  icon: string;
  key: string;
}

export interface HistoryRows {
  snapshots: SnapshotRow[];
  states: StateRow[];
}

/**
 * Which row carries the history-brush glyph. `null` means the engine default (state 0),
 * which PS shows on the first snapshot when one was taken there.
 */
export function sourceRow(source: HistorySource | null, snapshots: HistoryInput["snapshots"]): { kind: "snapshot"; id: string } | { kind: "state"; index: number } {
  if (source) return source;
  const first = snapshots.find((s) => s.historyIndex === 0);
  return first ? { kind: "snapshot", id: first.id } : { kind: "state", index: 0 };
}

export function buildHistoryRows(input: HistoryInput): HistoryRows {
  const src = sourceRow(input.source, input.snapshots);
  const snapshots: SnapshotRow[] = input.snapshots.map((s) => ({
    kind: "snapshot",
    id: s.id,
    name: s.name,
    isSource: src.kind === "snapshot" && src.id === s.id,
    atCurrent: s.historyIndex === input.index,
  }));
  const states: StateRow[] = [];
  const origin = input.evicted > 0 ? `${input.evicted} earlier state${input.evicted === 1 ? "" : "s"} forgotten` : input.opened ? "Open" : "New";
  states.push({ kind: "state", index: 0, label: origin, current: input.index === 0, undone: false, isSource: src.kind === "state" && src.index === 0, icon: input.opened ? "document" : "document-new", key: "origin" });
  input.entries.forEach((e, i) => {
    const index = i + 1;
    states.push({
      kind: "state",
      index,
      label: e.label,
      current: index === input.index,
      undone: index > input.index,
      isSource: src.kind === "state" && src.index === index,
      icon: iconForLabel(e.label),
      key: String(e.seq),
    });
  });
  return { snapshots, states };
}

/** A glyph that reads like PS's per-state tool icons, from the command label. */
export function iconForLabel(label: string): string {
  const l = label.toLowerCase();
  const table: [RegExp, string][] = [
    [/brush|paint|stroke/, "brush"],
    [/pencil/, "pencil"],
    [/eras/, "eraser"],
    [/fill|bucket/, "bucket"],
    [/gradient/, "gradient"],
    [/clone|stamp/, "clone"],
    [/heal|patch|spot/, "healing-brush"],
    [/blur/, "blur"],
    [/sharpen/, "sharpen"],
    [/smudge/, "smudge"],
    [/dodge/, "dodge"],
    [/burn/, "burn"],
    [/sponge/, "sponge"],
    [/select|marquee|lasso|wand|deselect|inverse|feather|expand|contract/, "marquee-rect"],
    [/crop|trim|canvas size/, "crop"],
    [/move|nudge|offset/, "move"],
    [/transform|scale|rotate|flip|skew/, "lock-position"],
    [/text|type/, "type-h"],
    [/shape|rect|ellipse|polygon|line/, "shape-rect"],
    [/path|pen|anchor/, "pen"],
    [/mask/, "mask"],
    [/adjust|levels|curves|hue|saturation|brightness|contrast|invert|threshold|posterize|color balance|vibrance|exposure/, "adjustment"],
    [/filter|noise|pixelate|sharpen|distort/, "filter"],
    [/group|folder/, "folder"],
    [/delete|remove|clear/, "trash"],
    [/duplicate|new layer|add layer|paste|layer via/, "new-layer"],
    [/merge|flatten|rasterize/, "layers"],
    [/snapshot|restore/, "snapshot"],
    [/ai|generate|chatgpt|grok|gemini/, "ai"],
    [/visib|hide|show/, "eye"],
    [/opacity|blend|properties|rename|lock|link/, "properties"],
  ];
  for (const [re, icon] of table) if (re.test(l)) return icon;
  return "document";
}

/** PS "Clear History" keeps the snapshots; here the engine clears both, so re-take the first one. */
export function needsFirstSnapshot(snapshotCount: number, autoFirst: boolean): boolean {
  return autoFirst && snapshotCount === 0;
}

/** Row clicked → the `History.jumpTo` target, or null when it is the current state. */
export function jumpTargetFor(row: StateRow, currentIndex: number): number | null {
  return row.index === currentIndex ? null : row.index;
}
