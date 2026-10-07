/**
 * Select menu (PS): All, Deselect, Reselect, Inverse, All Layers, Deselect Layers,
 * Color Range…, Modify ▸ Border / Smooth / Expand / Contract / Feather, Grow, Similar,
 * Transform Selection, Edit in Quick Mask Mode, Load Selection…, Save Selection….
 * (Refine Edge is skipped per PLAN-v2.)
 */
import {
  AddAlphaChannelCommand,
  Selection,
  SetAlphaChannelCommand,
  SetSelectionCommand,
  activeLayer,
  compositeToRaster,
  loadChannelAsSelection,
  saveSelectionAsChannel,
  selectionFromLayer,
} from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import NumberDialog from "../dialogs/NumberDialog.svelte";
import { canvasHost } from "../canvas/host.svelte";
import ColorRangeDialog from "$lib/tools/ui/ColorRangeDialog.svelte";
import SelectionChannelDialog from "$lib/tools/ui/SelectionChannelDialog.svelte";
import { borderSelection, growSelection, similarSelection, type ChannelChoice, type SelectionChannelResult } from "$lib/tools/select-ops";
import { getTool, TransformSelectionTool } from "$lib/tools";

/** Last non-empty selection per document (for Reselect). */
const lastSelection = new Map<string, Selection>();

function setSel(next: Selection, label: string): void {
  const entry = docStore.active;
  if (!entry) return;
  const cur = entry.doc.selection;
  if (!cur.isEmpty) lastSelection.set(entry.id, cur);
  docStore.exec(new SetSelectionCommand(next, label));
}

const hasDoc = () => !!docStore.doc;
const hasSel = () => !!docStore.doc && !docStore.doc.selection.isEmpty;

interface NumArgs {
  title: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  initial: number;
  okLabel?: string;
}

async function askNumber(args: NumArgs): Promise<number | null> {
  return openDialog<NumArgs, number>(NumberDialog, args);
}

/** Magic Wand tolerance (Grow / Similar use it, as in PS). */
function wandTolerance(): number {
  return toolStore.option("wand", "tolerance", 32);
}

registerCommands([
  { id: "select.all", label: "All", menu: "Select", order: 100, shortcut: "CmdOrCtrl+A", enabled: hasDoc, run: () => { const d = docStore.doc; if (d) setSel(Selection.all(d.width, d.height), "Select All"); } },
  { id: "select.none", label: "Deselect", menu: "Select", order: 101, shortcut: "CmdOrCtrl+D", enabled: hasSel, run: () => { const d = docStore.doc; if (d) setSel(Selection.none(d.width, d.height), "Deselect"); } },
  {
    id: "select.reselect",
    label: "Reselect",
    menu: "Select",
    order: 102,
    shortcut: "CmdOrCtrl+Shift+D",
    enabled: () => !!docStore.active && lastSelection.has(docStore.active.id),
    run: () => {
      const e = docStore.active;
      const s = e && lastSelection.get(e.id);
      if (e && s && s.width === e.doc.width && s.height === e.doc.height) docStore.exec(new SetSelectionCommand(s, "Reselect"));
    },
  },
  { id: "select.inverse", label: "Inverse", menu: "Select", order: 103, shortcut: "CmdOrCtrl+Shift+I", enabled: hasSel, run: () => { const d = docStore.doc; if (d) setSel(d.selection.invert(), "Inverse Selection"); } },

  {
    id: "select.allLayers",
    label: "All Layers",
    menu: "Select",
    order: 200,
    shortcut: "CmdOrCtrl+Alt+A",
    enabled: hasDoc,
    run: async () => {
      // Layers panel multi-select lives with layers-v2; select every layer when its store is present.
      const mod = await import("$lib/ui/panels/Layers.store.svelte").catch(() => null);
      const d = docStore.doc;
      if (!d || !mod) return;
      const store = (mod as { layersUi?: { setSelection?: (ids: string[]) => void } }).layersUi;
      store?.setSelection?.(d.layers.map((l) => l.id));
      docStore.touch();
    },
  },
  {
    id: "select.deselectLayers",
    label: "Deselect Layers",
    menu: "Select",
    order: 201,
    enabled: hasDoc,
    run: async () => {
      const mod = await import("$lib/ui/panels/Layers.store.svelte").catch(() => null);
      const store = (mod as { layersUi?: { setSelection?: (ids: string[]) => void } } | null)?.layersUi;
      store?.setSelection?.([]);
      docStore.touch();
    },
  },
  {
    id: "select.fromLayer",
    label: "Load Layer Transparency",
    menu: "Select",
    order: 202,
    keywords: ["select pixels", "transparency", "layer alpha"],
    enabled: () => { const d = docStore.doc; const l = d && activeLayer(d); return !!l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text"); },
    run: () => {
      const d = docStore.doc;
      const l = d && activeLayer(d);
      if (!d || !l) return;
      const s = selectionFromLayer(d, l.id);
      if (!s || s.isEmpty) {
        toast.info("The layer is fully transparent.");
        return;
      }
      setSel(s, "Select Layer Pixels");
    },
  },

  {
    id: "select.colorRange",
    label: "Color Range…",
    menu: "Select",
    order: 300,
    keywords: ["select color", "fuzziness", "sample"],
    enabled: hasDoc,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const comp = compositeToRaster(d);
      const s = await openDialog<{ composite: typeof comp; initialColor: typeof toolStore.fg }, Selection>(ColorRangeDialog, { composite: comp, initialColor: { ...toolStore.fg } });
      if (s) setSel(s, "Color Range");
    },
  },

  { id: "select.modify.border", label: "Border…", menu: "Select/Modify", order: 400, enabled: hasSel, run: async () => { const d = docStore.doc; if (!d) return; const r = await askNumber({ title: "Border Selection", label: "Width", min: 1, max: 200, initial: 4, okLabel: "OK" }); if (r !== null) setSel(borderSelection(d.selection, r), "Border"); } },
  { id: "select.modify.smooth", label: "Smooth…", menu: "Select/Modify", order: 401, enabled: hasSel, run: async () => { const d = docStore.doc; if (!d) return; const r = await askNumber({ title: "Smooth Selection", label: "Sample Radius", min: 1, max: 100, initial: 2, okLabel: "OK" }); if (r !== null) { const { smoothSelection } = await import("$lib/tools/select-ops"); setSel(smoothSelection(d.selection, r), "Smooth"); } } },
  { id: "select.expand", label: "Expand…", menu: "Select/Modify", order: 402, enabled: hasSel, run: async () => { const d = docStore.doc; if (!d) return; const r = await askNumber({ title: "Expand Selection", label: "Expand By", min: 1, max: 500, initial: 4, okLabel: "OK" }); if (r !== null) setSel(d.selection.expand(Math.round(r)), "Expand"); } },
  { id: "select.contract", label: "Contract…", menu: "Select/Modify", order: 403, enabled: hasSel, run: async () => { const d = docStore.doc; if (!d) return; const r = await askNumber({ title: "Contract Selection", label: "Contract By", min: 1, max: 500, initial: 4, okLabel: "OK" }); if (r !== null) setSel(d.selection.contract(Math.round(r)), "Contract"); } },
  { id: "select.feather", label: "Feather…", menu: "Select/Modify", order: 404, shortcut: "Shift+F6", enabled: hasSel, run: async () => { const d = docStore.doc; if (!d) return; const r = await askNumber({ title: "Feather Selection", label: "Feather Radius", min: 0.1, max: 250, step: 0.5, initial: 4, okLabel: "OK" }); if (r !== null) setSel(d.selection.feather(r), "Feather"); } },

  { id: "select.grow", label: "Grow", menu: "Select", order: 500, enabled: hasSel, run: () => { const d = docStore.doc; if (d) setSel(growSelection(d.selection, compositeToRaster(d), wandTolerance()), "Grow"); } },
  { id: "select.similar", label: "Similar", menu: "Select", order: 501, enabled: hasSel, run: () => { const d = docStore.doc; if (d) setSel(similarSelection(d.selection, compositeToRaster(d), wandTolerance()), "Similar"); } },

  {
    id: "select.transform",
    label: "Transform Selection",
    menu: "Select",
    order: 600,
    enabled: hasSel,
    run: () => {
      const tool = getTool("transform-selection");
      const prev = toolStore.activeToolId;
      if (!(tool instanceof TransformSelectionTool)) return;
      canvasHost.activateTool(tool.id);
      const ctx = canvasHost.context(tool);
      if (!ctx || !tool.begin(ctx, prev === tool.id ? "marquee-rect" : prev)) {
        canvasHost.activateTool(prev);
        toast.info("Make a selection first.");
      }
      canvasHost.invalidateOverlay();
    },
  },

  {
    id: "select.loadSelection",
    label: "Load Selection…",
    menu: "Select",
    order: 700,
    enabled: () => !!docStore.doc && docStore.doc.alphaChannels.length > 0,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const channels: ChannelChoice[] = d.alphaChannels.map((c) => ({ id: c.id, name: c.name }));
      const r = await openDialog<{ kind: "load"; channels: ChannelChoice[]; hasSelection: boolean; defaultName: string }, SelectionChannelResult>(SelectionChannelDialog, { kind: "load", channels, hasSelection: !d.selection.isEmpty, defaultName: "" });
      if (!r?.channelId) return;
      const s = loadChannelAsSelection(d, r.channelId, r.mode, r.invert);
      if (s) setSel(s, "Load Selection");
    },
  },
  {
    id: "select.saveSelection",
    label: "Save Selection…",
    menu: "Select",
    order: 701,
    enabled: hasSel,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const channels: ChannelChoice[] = d.alphaChannels.map((c) => ({ id: c.id, name: c.name }));
      const r = await openDialog<{ kind: "save"; channels: ChannelChoice[]; hasSelection: boolean; defaultName: string }, SelectionChannelResult>(SelectionChannelDialog, { kind: "save", channels, hasSelection: true, defaultName: `Alpha ${d.alphaChannels.length + 1}` });
      if (!r) return;
      if (r.channelId) {
        const ch = saveSelectionAsChannel(d, undefined, { id: r.channelId, mode: r.mode });
        docStore.exec(new SetAlphaChannelCommand(r.channelId, { mask: ch.mask }, "Save Selection"));
      } else {
        docStore.exec(new AddAlphaChannelCommand(saveSelectionAsChannel(d, r.name)));
      }
      toast.success(r.channelId ? "Selection saved to channel." : `Saved as "${r.name}".`);
    },
  },
]);
