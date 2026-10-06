/** "Untitled-1 @ 66.7% (Layer 1, RGB/8)" — Photoshop's document title (tab, title bar). */
import { formatZoom } from "$lib/engine";

export interface TitleSource {
  doc: { name: string; layers: readonly { id: string; name: string }[]; activeLayerId: string | null };
  viewport: { zoom: number };
  dirty?: boolean;
}

export function docTitle(e: TitleSource, opts: { dirtyMark?: boolean } = {}): string {
  const layer = e.doc.layers.find((l) => l.id === e.doc.activeLayerId)?.name;
  const base = `${e.doc.name} @ ${formatZoom(e.viewport.zoom)} (${layer ? `${layer}, ` : ""}RGB/8)`;
  return opts.dirtyMark && e.dirty ? `${base} *` : base;
}
