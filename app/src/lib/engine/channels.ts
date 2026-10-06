/**
 * Alpha channels (saved selections), Quick Mask mode and channel-view rendering.
 *
 * Channel rasters are document-sized RGBA rasters with the value in the **red**
 * channel (G/B mirror it, alpha 255) so they can be painted with the normal tools and
 * uploaded as textures without conversion.
 */

import { Raster } from "./raster";
import { Selection } from "./selection";
import { newId, findAlphaChannel, findLayer } from "./document";
import type { AlphaChannel, Document, LayerId, QuickMask, RGBA, ViewChannel } from "./types";

export type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";

/** Build an alpha-channel object from a selection (not added to the document). */
export function channelFromSelection(doc: Document, sel: Selection, name?: string): AlphaChannel {
  return {
    id: newId("ch"),
    name: name ?? `Alpha ${doc.alphaChannels.length + 1}`,
    mask: sel.toLuminanceMask(),
    color: { r: 255, g: 0, b: 0, a: 255 },
    opacity: 0.5,
  };
}

/**
 * Select ▸ Save Selection: store the current selection as a new alpha channel (or
 * replace / combine into an existing one with `into`). Returns the channel; the caller
 * pushes `AddAlphaChannelCommand` / `SetAlphaChannelCommand` for undo.
 */
export function saveSelectionAsChannel(doc: Document, name?: string, into?: { id: string; mode: SelectionCombineMode }): AlphaChannel {
  if (into) {
    const ch = findAlphaChannel(doc, into.id);
    if (ch) {
      const combined = combineSelections(Selection.fromLuminance(ch.mask), doc.selection, into.mode);
      return { ...ch, mask: combined.toLuminanceMask() };
    }
  }
  return channelFromSelection(doc, doc.selection, name);
}

/** Combine `b` into `a` with a Select ▸ Load Selection operation. */
export function combineSelections(a: Selection, b: Selection, mode: SelectionCombineMode): Selection {
  switch (mode) {
    case "replace":
      return b;
    case "add":
      return a.add(b);
    case "subtract":
      return a.subtract(b);
    case "intersect":
      return a.intersect(b);
  }
}

/**
 * Select ▸ Load Selection: the channel as a selection combined with the current one.
 * Returns the new selection (push with `SetSelectionCommand`), or null for unknown ids.
 */
export function loadChannelAsSelection(doc: Document, channelId: string, mode: SelectionCombineMode = "replace", invert = false): Selection | null {
  const ch = findAlphaChannel(doc, channelId);
  if (!ch) return null;
  let s = Selection.fromLuminance(ch.mask);
  if (invert) s = s.invert();
  return combineSelections(doc.selection, s, mode);
}

/** A layer mask as a selection (Ctrl-click mask thumbnail). */
export function loadMaskAsSelection(doc: Document, layerId: LayerId, mode: SelectionCombineMode = "replace"): Selection | null {
  const l = findLayer(doc, layerId);
  if (!l?.mask) return null;
  const s = new Selection(doc.width, doc.height);
  const m = l.mask;
  for (let y = 0; y < m.height; y++) {
    const dy = y + l.offset.y;
    if (dy < 0 || dy >= doc.height) continue;
    for (let x = 0; x < m.width; x++) {
      const dx = x + l.offset.x;
      if (dx < 0 || dx >= doc.width) continue;
      s.mask[dy * doc.width + dx] = m.data[(y * m.width + x) * 4]!;
    }
  }
  s.invalidate();
  return combineSelections(doc.selection, s, mode);
}

/**
 * Enter Quick Mask mode (Q): the selection becomes an editable document-sized raster
 * (`doc.quickMask.raster`, 255 = selected) and the selection is cleared so tools paint
 * the mask. No-op when already active.
 */
export function enterQuickMask(doc: Document): QuickMask {
  const qm = doc.quickMask;
  if (qm.active) return qm;
  qm.raster = doc.selection.isEmpty ? Raster.filled(doc.width, doc.height, { r: 0, g: 0, b: 0, a: 255 }) : doc.selection.toLuminanceMask();
  qm.active = true;
  doc.selection = Selection.none(doc.width, doc.height);
  doc.dirty = true;
  return qm;
}

/** Exit Quick Mask mode: the raster becomes the selection again. Returns the new selection. */
export function exitQuickMask(doc: Document): Selection {
  const qm = doc.quickMask;
  if (!qm.active || !qm.raster) return doc.selection;
  const sel = Selection.fromLuminance(qm.raster);
  qm.active = false;
  qm.raster = null;
  doc.selection = sel;
  doc.dirty = true;
  return sel;
}

/** Paint-tool helper: the raster to paint on while in Quick Mask mode, else null. */
export function quickMaskTarget(doc: Document): Raster | null {
  return doc.quickMask.active ? doc.quickMask.raster : null;
}

/** Parse a `ViewChannel` string. */
export function parseViewChannel(v: ViewChannel): { kind: "rgb" | "r" | "g" | "b" | "mask" } | { kind: "alpha"; id: string } {
  if (v.startsWith("alpha:")) return { kind: "alpha", id: v.slice(6) };
  return { kind: v as "rgb" | "r" | "g" | "b" | "mask" };
}

/**
 * The grayscale raster to display for a channel view, or null for `"rgb"` / unknown
 * channels. Single channels of the composite are rendered as opaque gray; alpha
 * channels and masks are their stored rasters (document-sized, red channel), where a
 * layer mask smaller than the document is placed at the layer's offset on white.
 */
export function channelViewRaster(doc: Document, composite: Raster, view: ViewChannel, activeLayerId?: LayerId | null): Raster | null {
  const v = parseViewChannel(view);
  if (v.kind === "rgb") return null;
  const w = doc.width;
  const h = doc.height;
  const out = new Raster(w, h);
  const d = out.data;
  if (v.kind === "r" || v.kind === "g" || v.kind === "b") {
    const ch = v.kind === "r" ? 0 : v.kind === "g" ? 1 : 2;
    const c = composite.data;
    for (let i = 0; i < d.length; i += 4) {
      // Transparent pixels show as black (PS shows the channel of the flattened image).
      const val = (c[i + ch]! * c[i + 3]!) / 255;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    return out;
  }
  let src: Raster | null = null;
  let ox = 0;
  let oy = 0;
  if (v.kind === "alpha") src = findAlphaChannel(doc, v.id)?.mask ?? null;
  else {
    const l = activeLayerId ? findLayer(doc, activeLayerId) : undefined;
    src = l?.mask ?? null;
    ox = l?.offset.x ?? 0;
    oy = l?.offset.y ?? 0;
  }
  if (!src) return null;
  out.fill({ r: 255, g: 255, b: 255, a: 255 });
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= h) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= w) continue;
      const val = src.data[(y * src.width + x) * 4]!;
      const i = (dy * w + dx) * 4;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Tint `display` (document-sized, in place) with the quick mask: the masked (unselected)
 * areas get `color` at `opacity` (or the selected areas when `maskedAreas` is false).
 */
export function overlayQuickMask(display: Raster, qm: QuickMask): void {
  if (!qm.active || !qm.raster) return;
  overlayChannel(display, qm.raster, qm.color, qm.opacity, qm.maskedAreas);
}

/** Tint `display` where a channel raster is low (`maskedAreas`) or high. Used for quick mask and channel overlays. */
export function overlayChannel(display: Raster, channel: Raster, color: RGBA, opacity: number, maskedAreas: boolean): void {
  const d = display.data;
  const m = channel.data;
  const n = Math.min(d.length, m.length);
  for (let i = 0; i < n; i += 4) {
    const v = m[i]! / 255;
    const k = (maskedAreas ? 1 - v : v) * opacity;
    if (k <= 0) continue;
    // Tint over whatever is displayed; transparent pixels get the tint on top of nothing.
    const a = d[i + 3]! / 255;
    const ao = k + a * (1 - k);
    const wd = (a * (1 - k)) / ao;
    const ws = k / ao;
    d[i] = color.r * ws + d[i]! * wd;
    d[i + 1] = color.g * ws + d[i + 1]! * wd;
    d[i + 2] = color.b * ws + d[i + 2]! * wd;
    d[i + 3] = ao * 255;
  }
}
