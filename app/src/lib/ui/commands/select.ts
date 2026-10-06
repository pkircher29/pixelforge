/** Select menu. */
import { Selection, SetSelectionCommand, activeLayer } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import NumberDialog from "../dialogs/NumberDialog.svelte";

/** Last non-empty selection per document (for Reselect). */
const lastSelection = new Map<string, Selection>();

function setSel(next: Selection, label: string): void {
  const entry = docStore.active;
  if (!entry) return;
  const cur = entry.doc.selection;
  if (!cur.isEmpty) lastSelection.set(entry.id, cur);
  docStore.exec(new SetSelectionCommand(next, label));
}

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

registerCommands([
  { id: "select.all", label: "All", menu: "Select", order: 100, shortcut: "CmdOrCtrl+A", enabled: () => !!docStore.doc, run: () => { const d = docStore.doc; if (d) setSel(Selection.all(d.width, d.height), "Select All"); } },
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
    id: "select.fromLayer",
    label: "From layer alpha",
    menu: "Select",
    order: 200,
    shortcut: "CmdOrCtrl+Alt+A",
    keywords: ["select pixels", "transparency"],
    enabled: () => { const d = docStore.doc; const l = d && activeLayer(d); return !!l && l.kind === "raster"; },
    run: () => {
      const d = docStore.doc;
      const l = d && activeLayer(d);
      if (!d || !l || l.kind !== "raster") return;
      const s = Selection.fromLayerAlpha(l.raster, { size: { w: d.width, h: d.height }, offset: l.offset });
      if (s.isEmpty) {
        toast.info("The layer is fully transparent.");
        return;
      }
      setSel(s, "Select Layer Pixels");
    },
  },
  {
    id: "select.feather",
    label: "Feather…",
    menu: "Select/Modify",
    order: 300,
    shortcut: "Shift+F6",
    enabled: hasSel,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const r = await askNumber({ title: "Feather selection", label: "Radius", min: 0.1, max: 250, step: 0.5, initial: 4, okLabel: "Feather" });
      if (r !== null) setSel(d.selection.feather(r), "Feather");
    },
  },
  {
    id: "select.expand",
    label: "Expand…",
    menu: "Select/Modify",
    order: 301,
    enabled: hasSel,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const r = await askNumber({ title: "Expand selection", label: "By", min: 1, max: 500, initial: 4, okLabel: "Expand" });
      if (r !== null) setSel(d.selection.expand(Math.round(r)), "Expand Selection");
    },
  },
  {
    id: "select.contract",
    label: "Contract…",
    menu: "Select/Modify",
    order: 302,
    enabled: hasSel,
    run: async () => {
      const d = docStore.doc;
      if (!d) return;
      const r = await askNumber({ title: "Contract selection", label: "By", min: 1, max: 500, initial: 4, okLabel: "Contract" });
      if (r !== null) setSel(d.selection.contract(Math.round(r)), "Contract Selection");
    },
  },
]);
