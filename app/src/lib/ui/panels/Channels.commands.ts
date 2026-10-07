/**
 * Channels panel actions + palette commands (`channels.*`). Module-level so the panel
 * body, its ≡ menu and the command palette share one implementation.
 */
import {
  AddAlphaChannelCommand,
  RemoveAlphaChannelCommand,
  RenameAlphaChannelCommand,
  Selection,
  SetAlphaChannelCommand,
  SetSelectionCommand,
  channelFromSelection,
  channelViewRaster,
  combineSelections,
  compositeToRaster,
  loadChannelAsSelection,
  loadMaskAsSelection,
  type AlphaChannel,
  type Raster,
  type SelectionCombineMode,
  type ViewChannel,
} from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import { layersUi } from "./Layers.store.svelte";
import type { ChannelRow } from "./Channels.model";
import ChannelsOptionsDialog from "./ChannelsOptionsDialog.svelte";

export function applyChannelView(next: { view: ViewChannel; hidden: string[] }): void {
  ui.viewChannel = next.view;
  layersUi.hiddenChannels = next.hidden;
  docStore.touch();
}

/** The alpha channel currently viewed, or null. */
export function selectedAlpha(): AlphaChannel | null {
  const d = docStore.doc;
  const v = ui.viewChannel;
  if (!d || !v.startsWith("alpha:")) return null;
  return d.alphaChannels.find((c) => c.id === v.slice(6)) ?? null;
}

function luminance(r: Raster): Raster {
  const out = r.clone();
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = ((0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) * d[i + 3]!) / 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  return out;
}

/** Ctrl-click / bottom-bar: the channel as a selection. */
export function loadChannelSelection(row: ChannelRow, mode: SelectionCombineMode = "replace"): void {
  const d = docStore.doc;
  if (!d) return;
  let s: Selection | null = null;
  if (row.kind === "alpha") s = loadChannelAsSelection(d, row.id, mode);
  else if (row.kind === "mask" && d.activeLayerId) s = loadMaskAsSelection(d, d.activeLayerId, mode);
  else {
    const comp = compositeToRaster(d);
    const r = row.kind === "composite" ? luminance(comp) : channelViewRaster(d, comp, row.view, d.activeLayerId);
    if (r) s = combineSelections(d.selection, Selection.fromLuminance(r), mode);
  }
  if (s) docStore.exec(new SetSelectionCommand(s, "Load Selection"));
}

export async function channelOptions(ch: AlphaChannel): Promise<void> {
  const r = await openDialog<{ name: string; color: AlphaChannel["color"]; opacity: number }, { name: string; color: AlphaChannel["color"]; opacity: number }>(ChannelsOptionsDialog, { name: ch.name, color: ch.color, opacity: ch.opacity });
  if (!r) return;
  if (r.name !== ch.name) docStore.exec(new RenameAlphaChannelCommand(ch.id, r.name));
  docStore.exec(new SetAlphaChannelCommand(ch.id, { color: r.color, opacity: r.opacity }));
}

export function saveSelectionAsChannel(): void {
  const d = docStore.doc;
  if (!d || d.selection.isEmpty) {
    toast.info("Make a selection first.");
    return;
  }
  docStore.exec(new AddAlphaChannelCommand(channelFromSelection(d, d.selection)));
}

export function newChannel(): void {
  const d = docStore.doc;
  if (!d) return;
  const ch = channelFromSelection(d, Selection.none(d.width, d.height));
  docStore.exec(new AddAlphaChannelCommand(ch));
  applyChannelView({ view: `alpha:${ch.id}`, hidden: ["r", "g", "b"] });
}

export function deleteChannel(): void {
  const ch = selectedAlpha();
  if (!ch) return;
  docStore.exec(new RemoveAlphaChannelCommand(ch.id));
  applyChannelView({ view: "rgb", hidden: [] });
}

export function duplicateChannel(): void {
  const ch = selectedAlpha();
  if (!ch) return;
  docStore.exec(new AddAlphaChannelCommand({ ...ch, id: `${ch.id}_copy_${Date.now().toString(36)}`, name: `${ch.name} copy`, mask: ch.mask.clone() }));
}

/** PS channel shortcuts: Ctrl+2 composite, Ctrl+3/4/5 R/G/B, Ctrl+6… alpha channels. */
const viewCmd = (id: string, label: string, key: string, view: () => ViewChannel | null): Parameters<typeof registerCommands>[0][number] => ({
  id,
  label,
  shortcut: `CmdOrCtrl+${key}`,
  keywords: ["channel", "view"],
  enabled: () => !!docStore.doc && view() !== null,
  run: () => {
    const v = view();
    if (v) applyChannelView({ view: v, hidden: v === "rgb" ? [] : layersUi.hiddenChannels });
  },
});
registerCommands([
  viewCmd("channels.view.rgb", "View RGB Composite", "2", () => "rgb"),
  viewCmd("channels.view.r", "View Red Channel", "3", () => "r"),
  viewCmd("channels.view.g", "View Green Channel", "4", () => "g"),
  viewCmd("channels.view.b", "View Blue Channel", "5", () => "b"),
  ...[0, 1, 2, 3].map((i) =>
    viewCmd(`channels.view.alpha${i}`, `View Alpha Channel ${i + 1}`, String(6 + i), () => {
      const c = docStore.doc?.alphaChannels[i];
      return c ? (`alpha:${c.id}` as ViewChannel) : null;
    }),
  ),
  { id: "channels.new", label: "New Channel…", keywords: ["alpha channel"], enabled: () => !!docStore.doc, run: newChannel },
  { id: "channels.duplicate", label: "Duplicate Channel…", enabled: () => !!selectedAlpha(), run: duplicateChannel },
  { id: "channels.delete", label: "Delete Channel", enabled: () => !!selectedAlpha(), run: deleteChannel },
  { id: "channels.spot", label: "New Spot Channel…", enabled: () => false, run: () => {} },
  { id: "channels.options", label: "Channel Options…", enabled: () => !!selectedAlpha(), run: () => { const c = selectedAlpha(); if (c) void channelOptions(c); } },
  { id: "select.save", label: "Save Selection as Channel", order: 800, enabled: () => !!docStore.doc && !docStore.doc.selection.isEmpty, run: saveSelectionAsChannel },
  { id: "select.load", label: "Load Last Channel as Selection", order: 801, enabled: () => !!docStore.doc && docStore.doc.alphaChannels.length > 0, run: () => { const d = docStore.doc; const ch = selectedAlpha() ?? d?.alphaChannels[d.alphaChannels.length - 1]; if (ch) loadChannelSelection({ id: ch.id, name: ch.name, view: `alpha:${ch.id}`, kind: "alpha", shortcut: null, visible: true, selected: true }); } },
]);
