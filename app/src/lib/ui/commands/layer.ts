/** Layer menu. */
import {
  AddLayerCommand,
  DuplicateLayerCommand,
  FlattenCommand,
  GroupLayersCommand,
  MergeDownCommand,
  MergeVisibleCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
  SetLayerPropsCommand,
  UngroupLayersCommand,
  activeLayer,
  createRasterLayer,
  flipLayerCommand,
  layerBlock,
  layerIndex,
  rotateLayer90Command,
  type Layer,
  type LayerProps,
} from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { registerCommands } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import LayerPropsDialog from "../dialogs/LayerPropsDialog.svelte";
import { removeDiffOverlay } from "$lib/ai/overlay";

/** Merges bake pixels together: drop the screen-only AI diff overlay first so it is never merged in. */
function dropOverlay(): void {
  const open = docStore.active;
  if (open) removeDiffOverlay(open);
}

const doc = () => docStore.doc;
const active = (): Layer | null => {
  const d = doc();
  return d ? (activeLayer(d) ?? null) : null;
};
const activeRaster = () => {
  const l = active();
  return l && l.kind === "raster" ? l : null;
};

/** Is there a sibling raster layer directly below the active one? */
function canMergeDown(): boolean {
  const d = doc();
  const l = active();
  if (!d || !l) return false;
  const i = layerIndex(d, l.id);
  for (let j = i - 1; j >= 0; j--) {
    const below = d.layers[j]!;
    if (below.parentId === l.parentId) return below.kind === "raster";
  }
  return false;
}

function siblings(d: ReturnType<typeof doc>, l: Layer): Layer[] {
  return d ? d.layers.filter((x) => x.parentId === l.parentId) : [];
}

function moveActive(dir: "up" | "down" | "top" | "bottom"): void {
  const d = doc();
  const l = active();
  if (!d || !l) return;
  const sib = siblings(d, l);
  const si = sib.indexOf(l);
  let targetSibling: Layer | undefined;
  if (dir === "up") targetSibling = sib[si + 1];
  else if (dir === "down") targetSibling = sib[si - 1];
  else if (dir === "top") targetSibling = sib[sib.length - 1];
  else targetSibling = sib[0];
  if (!targetSibling || targetSibling === l) return;
  const from = layerIndex(d, l.id);
  const myLen = layerBlock(d, l.id).end - from;
  const tb = layerBlock(d, targetSibling.id);
  let to: number;
  if (dir === "up" || dir === "top") to = tb.end - myLen; // after the target block (indices shift down by my block)
  else to = tb.start;
  docStore.exec(new ReorderLayerCommand(l.id, to));
}

async function properties(): Promise<void> {
  const l = active();
  if (!l) return;
  const r = await openDialog<{ name: string; opacity: number; blendMode: Layer["blendMode"]; isGroup: boolean }, Partial<LayerProps>>(LayerPropsDialog, {
    name: l.name,
    opacity: l.opacity,
    blendMode: l.blendMode,
    isGroup: l.kind === "group",
  });
  if (r) docStore.exec(new SetLayerPropsCommand(l.id, r, "Layer Properties"), { noMerge: true });
}

registerCommands([
  {
    id: "layer.new",
    label: "New layer",
    menu: "Layer",
    order: 100,
    shortcut: "CmdOrCtrl+Shift+N",
    enabled: () => !!doc(),
    run: () => {
      const d = doc();
      if (d) docStore.exec(new AddLayerCommand(createRasterLayer(d)));
    },
  },
  { id: "layer.duplicate", label: "Duplicate layer", menu: "Layer", order: 101, shortcut: "CmdOrCtrl+J", enabled: () => !!active(), run: () => { const l = active(); if (l) docStore.exec(new DuplicateLayerCommand(l.id)); } },
  {
    id: "layer.delete",
    label: "Delete layer",
    menu: "Layer",
    order: 102,
    enabled: () => !!active() && (doc()?.layers.length ?? 0) > 1,
    run: () => {
      const l = active();
      const d = doc();
      if (!l || !d) return;
      if (d.layers.length <= 1) {
        toast.info("A document needs at least one layer.");
        return;
      }
      docStore.exec(new RemoveLayerCommand(l.id));
    },
  },
  { id: "layer.properties", label: "Layer properties…", menu: "Layer", order: 103, enabled: () => !!active(), run: properties },
  {
    id: "layer.group",
    label: "Group layer",
    menu: "Layer",
    order: 200,
    shortcut: "CmdOrCtrl+G",
    enabled: () => { const l = active(); return !!l && l.kind === "raster" && l.parentId === null; },
    run: () => {
      const l = active();
      if (!l) return;
      if (l.kind !== "raster" || l.parentId !== null) {
        toast.info("Only top-level pixel layers can be grouped in v1.");
        return;
      }
      docStore.exec(new GroupLayersCommand([l.id]));
    },
  },
  {
    id: "layer.ungroup",
    label: "Ungroup",
    menu: "Layer",
    order: 201,
    shortcut: "CmdOrCtrl+Shift+G",
    enabled: () => { const l = active(); return !!l && (l.kind === "group" || l.parentId !== null); },
    run: () => {
      const d = doc();
      const l = active();
      if (!d || !l) return;
      const gid = l.kind === "group" ? l.id : l.parentId;
      if (gid) docStore.exec(new UngroupLayersCommand(gid));
    },
  },
  { id: "layer.bringForward", label: "Bring forward", menu: "Layer/Arrange", order: 300, shortcut: "CmdOrCtrl+]", enabled: () => !!active(), run: () => moveActive("up") },
  { id: "layer.sendBackward", label: "Send backward", menu: "Layer/Arrange", order: 301, shortcut: "CmdOrCtrl+[", enabled: () => !!active(), run: () => moveActive("down") },
  { id: "layer.bringToFront", label: "Bring to front", menu: "Layer/Arrange", order: 302, shortcut: "CmdOrCtrl+Shift+]", enabled: () => !!active(), run: () => moveActive("top") },
  { id: "layer.sendToBack", label: "Send to back", menu: "Layer/Arrange", order: 303, shortcut: "CmdOrCtrl+Shift+[", enabled: () => !!active(), run: () => moveActive("bottom") },
  { id: "layer.flipH", label: "Flip layer horizontal", menu: "Layer/Transform", order: 350, enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(flipLayerCommand(d, l.id, "h")); } },
  { id: "layer.flipV", label: "Flip layer vertical", menu: "Layer/Transform", order: 351, enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(flipLayerCommand(d, l.id, "v")); } },
  { id: "layer.rotateCW", label: "Rotate layer 90° clockwise", menu: "Layer/Transform", order: 352, enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(rotateLayer90Command(d, l.id, true)); } },
  { id: "layer.rotateCCW", label: "Rotate layer 90° counter-clockwise", menu: "Layer/Transform", order: 353, enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(rotateLayer90Command(d, l.id, false)); } },
  { id: "layer.mergeDown", label: "Merge down", menu: "Layer", order: 400, shortcut: "CmdOrCtrl+E", enabled: canMergeDown, run: () => { dropOverlay(); const l = active(); if (l && canMergeDown()) docStore.exec(new MergeDownCommand(l.id)); } },
  { id: "layer.mergeVisible", label: "Merge visible", menu: "Layer", order: 401, shortcut: "CmdOrCtrl+Shift+M", enabled: () => (doc()?.layers.length ?? 0) > 1, run: () => { dropOverlay(); if ((doc()?.layers.length ?? 0) > 1) docStore.exec(new MergeVisibleCommand()); } },
  { id: "layer.flatten", label: "Flatten image", menu: "Layer", order: 402, enabled: () => (doc()?.layers.length ?? 0) > 1, run: () => { dropOverlay(); if ((doc()?.layers.length ?? 0) > 1) docStore.exec(new FlattenCommand()); } },
  { id: "layer.toggleVisible", label: "Show / hide layer", menu: "Layer", order: 500, enabled: () => !!active(), run: () => { const l = active(); if (l) docStore.exec(new SetLayerPropsCommand(l.id, { visible: !l.visible })); } },
  { id: "layer.toggleLock", label: "Lock / unlock layer", menu: "Layer", order: 501, shortcut: "CmdOrCtrl+/", enabled: () => !!active(), run: () => { const l = active(); if (l) docStore.exec(new SetLayerPropsCommand(l.id, { locked: !l.locked })); } },
]);
