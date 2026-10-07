/**
 * Channels panel model (pure): the row list (RGB, Red, Green, Blue, alpha channels,
 * the active layer's mask) and the PS eye rules mapped onto the engine's single
 * `ViewChannel`.
 */
import type { Document, Layer, ViewChannel } from "$lib/engine";

export interface ChannelRow {
  id: string;
  name: string;
  view: ViewChannel;
  kind: "composite" | "color" | "alpha" | "mask";
  /** Keyboard shortcut shown at the right (PS: Ctrl+2 … Ctrl+6). */
  shortcut: string | null;
  visible: boolean;
  selected: boolean;
}

/** Hidden-set semantics: `hidden` lists channel ids whose eye is off. */
export function buildChannelRows(doc: Document, activeLayer: Layer | null, view: ViewChannel, hidden: readonly string[]): ChannelRow[] {
  const h = new Set(hidden);
  const rows: ChannelRow[] = [
    { id: "rgb", name: "RGB", view: "rgb", kind: "composite", shortcut: "Ctrl+2", visible: !h.has("r") && !h.has("g") && !h.has("b"), selected: view === "rgb" },
    { id: "r", name: "Red", view: "r", kind: "color", shortcut: "Ctrl+3", visible: !h.has("r"), selected: view === "r" },
    { id: "g", name: "Green", view: "g", kind: "color", shortcut: "Ctrl+4", visible: !h.has("g"), selected: view === "g" },
    { id: "b", name: "Blue", view: "b", kind: "color", shortcut: "Ctrl+5", visible: !h.has("b"), selected: view === "b" },
  ];
  doc.alphaChannels.forEach((c, i) => {
    rows.push({ id: c.id, name: c.name, view: `alpha:${c.id}`, kind: "alpha", shortcut: i < 4 ? `Ctrl+${6 + i}` : null, visible: !h.has(c.id), selected: view === `alpha:${c.id}` });
  });
  if (activeLayer?.mask) {
    rows.push({ id: "mask", name: `${activeLayer.name} Mask`, view: "mask", kind: "mask", shortcut: "Ctrl+\\", visible: !h.has("mask"), selected: view === "mask" });
  }
  return rows;
}

/**
 * Click a row: PS selects the channel and shows only it (clicking RGB shows all color
 * channels; clicking a color channel hides the others; clicking an alpha / mask shows
 * just that one).
 */
export function clickChannel(row: ChannelRow, rows: readonly ChannelRow[] = []): { view: ViewChannel; hidden: string[] } {
  const extras = rows.filter((r) => (r.kind === "alpha" || r.kind === "mask") && r.id !== row.id).map((r) => r.id);
  if (row.kind === "composite") return { view: "rgb", hidden: extras };
  if (row.kind === "color") return { view: row.view, hidden: [...["r", "g", "b"].filter((c) => c !== row.id), ...extras] };
  return { view: row.view, hidden: ["r", "g", "b", ...extras] };
}

/**
 * Toggle a row's eye. The engine renders one channel at a time, so: turning a color
 * channel off leaves the other colors visible (view "rgb" when ≥ 2 are visible,
 * else the single visible color); turning the last color channel on returns to
 * "rgb"; alpha / mask eyes view that channel while on.
 */
export function toggleChannelEye(rows: readonly ChannelRow[], row: ChannelRow, view: ViewChannel, hidden: readonly string[]): { view: ViewChannel; hidden: string[] } {
  const h = new Set(hidden);
  if (row.kind === "composite") {
    if (row.visible) {
      // PS: hiding RGB hides the color channels (an alpha keeps showing if visible).
      ["r", "g", "b"].forEach((c) => h.add(c));
      const alpha = rows.find((r) => (r.kind === "alpha" || r.kind === "mask") && r.visible);
      return { view: alpha ? alpha.view : view, hidden: [...h] };
    }
    ["r", "g", "b"].forEach((c) => h.delete(c));
    return { view: "rgb", hidden: [...h] };
  }
  if (row.kind === "color") {
    if (row.visible) h.add(row.id);
    else h.delete(row.id);
    const visibleColors = ["r", "g", "b"].filter((c) => !h.has(c));
    if (visibleColors.length === 0) {
      const alpha = rows.find((r) => (r.kind === "alpha" || r.kind === "mask") && !h.has(r.id));
      return { view: alpha ? alpha.view : "rgb", hidden: [...h] };
    }
    return { view: visibleColors.length === 1 ? (visibleColors[0] as ViewChannel) : "rgb", hidden: [...h] };
  }
  // alpha / mask
  if (row.visible) {
    h.add(row.id);
    const colors = ["r", "g", "b"].filter((c) => !h.has(c));
    return { view: colors.length === 1 ? (colors[0] as ViewChannel) : "rgb", hidden: [...h] };
  }
  h.delete(row.id);
  return { view: row.view, hidden: [...h] };
}
