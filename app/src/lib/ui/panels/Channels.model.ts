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

function colorView(hidden: ReadonlySet<string>): ViewChannel {
  return (["r", "g", "b"].filter(c => !hidden.has(c)).join("") || "none") as ViewChannel;
}

/** Hidden-set semantics: `hidden` lists channel ids whose eye is off. */
export function buildChannelRows(doc: Document, activeLayer: Layer | null, view: ViewChannel, hidden: readonly string[], overlays: readonly string[] = []): ChannelRow[] {
  const h = new Set(hidden);
  const rows: ChannelRow[] = [
    { id: "rgb", name: "RGB", view: "rgb", kind: "composite", shortcut: "Ctrl+2", visible: !h.has("r") && !h.has("g") && !h.has("b"), selected: view === "rgb" },
    { id: "r", name: "Red", view: "r", kind: "color", shortcut: "Ctrl+3", visible: !h.has("r"), selected: view === "r" },
    { id: "g", name: "Green", view: "g", kind: "color", shortcut: "Ctrl+4", visible: !h.has("g"), selected: view === "g" },
    { id: "b", name: "Blue", view: "b", kind: "color", shortcut: "Ctrl+5", visible: !h.has("b"), selected: view === "b" },
  ];
  doc.alphaChannels.forEach((c, i) => {
    rows.push({ id: c.id, name: c.name, view: `alpha:${c.id}`, kind: "alpha", shortcut: i < 4 ? `Ctrl+${6 + i}` : null, visible: !h.has(c.id) && (view === `alpha:${c.id}` || overlays.includes(c.id)), selected: view === `alpha:${c.id}` });
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

/** Eye controls change visibility; visible alpha channels tint the color view. */
export function toggleChannelEye(rows: readonly ChannelRow[], row: ChannelRow, _view: ViewChannel, hidden: readonly string[]): { view: ViewChannel; hidden: string[]; overlays?: string[] } {
  const h = new Set(hidden);
  const alphas = new Set(rows.filter(r => r.kind === "alpha" && r.visible).map(r => r.id));
  if (row.kind === "mask") {
    if (row.visible) h.add(row.id); else h.delete(row.id);
    return { view: row.visible ? colorView(h) : row.view, hidden: [...h] };
  }
  if (row.kind === "composite") {
    for (const c of ["r", "g", "b"]) { if (row.visible) h.add(c); else h.delete(c); }
  } else if (row.kind === "color") {
    if (row.visible) h.add(row.id); else h.delete(row.id);
  } else {
    if (row.visible) { h.add(row.id); alphas.delete(row.id); }
    else { h.delete(row.id); alphas.add(row.id); }
  }
  const colors = colorView(h);
  if (colors === "none") {
    const alpha = rows.find(r => r.kind === "alpha" && alphas.has(r.id));
    return { view: alpha?.view ?? "none", hidden: [...h] };
  }
  return { view: colors, hidden: [...h], ...(alphas.size ? { overlays: [...alphas] } : {}) };
}
