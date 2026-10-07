/**
 * Layer menu — Photoshop CC order (PLAN-v2 §3 / layers-v2 brief). Commands act on the
 * Layers panel's multi-selection (`layersUi.selectedLayerIds` ∪ the active layer).
 * Existing v0.1 ids keep working (`layer.new`, `layer.duplicate`, `layer.delete`,
 * `layer.group`, `layer.ungroup`, `layer.mergeDown`, `layer.flatten`, ...).
 */
import {
  ADJUSTMENT_OPS,
  AddLayerCommand,
  ApplyMaskCommand,
  DuplicateLayerCommand,
  FlattenCommand,
  GroupLayersCommand,
  LinkLayersCommand,
  MergeDownCommand,
  MergeVisibleCommand,
  Rect,
  RemoveLayerCommand,
  ReorderLayerCommand,
  ReplaceLayerPixelsCommand,
  SetClipToBelowCommand,
  SetFillLayerCommand,
  SetLayerEffectsCommand,
  SetLayerLockCommand,
  SetLayerMaskCommand,
  SetLayerPropsCommand,
  SetMaskEnabledCommand,
  SetMaskLinkedCommand,
  UngroupLayersCommand,
  activeLayer,
  cloneEffects,
  createAdjustmentLayer,
  createFillLayer,
  createGroupLayer,
  createRasterLayer,
  defringe,
  flipLayerCommand,
  layerBlock,
  layerIndex,
  maskFromSelection,
  maskHideAll,
  maskRevealAll,
  removeMatte,
  rotateLayer90Command,
  solidFill,
  gradientFill,
  patternFill,
  Raster,
  DEFAULT_GLOBAL_LIGHT_ANGLE,
  DEFAULT_GLOBAL_LIGHT_ALTITUDE,
  type Command,
  type Document,
  type FillSpec,
  type Layer,
  type LayerEffects,
  type LayerId,
  type LayerLock,
  type LayerProps,
} from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { registerCommands, type CommandDef } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import LayerPropsDialog from "../dialogs/LayerPropsDialog.svelte";
import LayerPropsLockDialog from "../dialogs/LayerPropsLockDialog.svelte";
import LayerStyleDialog from "../dialogs/LayerStyleDialog.svelte";
import LayerStyleGlobalLightDialog from "../dialogs/LayerStyleGlobalLightDialog.svelte";
import NewLayerDialog, { type NewLayerResult } from "../dialogs/NewLayerDialog.svelte";
import FillLayerDialog from "../dialogs/FillLayerDialog.svelte";
import NumberDialog from "../dialogs/NumberDialog.svelte";
import LayersPanelOptionsDialog from "../panels/LayersPanelOptionsDialog.svelte";
import { layersUi } from "../panels/Layers.store.svelte";
import {
  BatchCommand,
  DeleteLayersCommand,
  RasterizeLayerCommand,
  SetLayersVisibleCommand,
  alignOffsets,
  canClip,
  canMergeDown,
  distributeOffsets,
  offsetsCommand,
  rasterInsideSelection,
  targetLayers,
  type AlignKind,
} from "../panels/Layers.model";
import { STYLE_PAGES, STYLE_LABEL, scaleEffects, setGlobalLight, type StylePage } from "../dialogs/layer-style-model";
import { removeDiffOverlay } from "$lib/ai/overlay";

/** Merges bake pixels together: drop the screen-only AI diff overlay first so it is never merged in. */
function dropOverlay(): void {
  const open = docStore.active;
  if (open) removeDiffOverlay(open);
}

const doc = (): Document | null => docStore.doc;
const active = (): Layer | null => {
  const d = doc();
  return d ? (activeLayer(d) ?? null) : null;
};
const targets = (): Layer[] => {
  const d = doc();
  return d ? targetLayers(d, layersUi.selectedLayerIds) : [];
};
const activePixel = () => {
  const l = active();
  return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l : null;
};
const activeRaster = () => {
  const l = active();
  return l && l.kind === "raster" ? l : null;
};
const hasDoc = () => !!doc();
const hasActive = () => !!active();
const hasSel = () => !!doc() && !doc()!.selection.isEmpty;

function select(ids: LayerId[]): void {
  layersUi.setSelection(ids);
  if (ids[0]) docStore.setActiveLayer(ids[ids.length - 1]!);
}

// ---------------------------------------------------------------- new layers

async function newLayerDialog(): Promise<void> {
  const d = doc();
  if (!d) return;
  const below = active();
  const r = await openDialog<{ name: string; canClip: boolean }, NewLayerResult>(NewLayerDialog, { name: nextName(d, "Layer"), canClip: !!below && below.kind !== "group" });
  if (!r) return;
  const layer = createRasterLayer(d, { name: r.name, blendMode: r.blendMode, opacity: r.opacity, color: r.color, clipToBelow: r.clip });
  docStore.exec(new AddLayerCommand(layer));
  select([layer.id]);
}

function nextName(d: Document, base: string): string {
  const used = new Set(d.layers.map((l) => l.name));
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function newLayerQuick(): void {
  const d = doc();
  if (!d) return;
  const layer = createRasterLayer(d);
  docStore.exec(new AddLayerCommand(layer));
  select([layer.id]);
}

function layerFromBackground(): void {
  const l = active();
  if (!l || l.kind !== "raster") return;
  docStore.exec(new BatchCommand("Layer From Background", [new SetLayerPropsCommand(l.id, { name: "Layer 0", locked: false }), new SetLayerLockCommand(l.id, { all: false, pixels: false, position: false, transparent: false })]));
}

function isBackground(): boolean {
  const d = doc();
  const l = active();
  return !!d && !!l && l.kind === "raster" && l.name === "Background" && layerIndex(d, l.id) === 0;
}

function newGroup(): void {
  const d = doc();
  if (!d) return;
  const g = createGroupLayer(d);
  const a = active();
  // Insert above the active layer's block at top level.
  const at = a ? layerBlock(d, a.parentId ?? a.id).end : d.layers.length;
  docStore.exec(new AddLayerCommand(g, at));
  select([g.id]);
}

function groupFromLayers(): void {
  const d = doc();
  const t = targets();
  if (!d || t.length === 0) return;
  const ids = t.filter((l) => l.kind !== "group" && l.parentId === null).map((l) => l.id);
  if (ids.length !== t.length) {
    toast.info("Groups can't be nested: select top-level layers to group them.");
    return;
  }
  const cmd = new GroupLayersCommand(ids);
  docStore.exec(cmd);
  if (cmd.groupId) select([cmd.groupId]);
}

function layerVia(cut: boolean): void {
  const d = doc();
  const l = activePixel();
  if (!d || !l) return;
  const sel = d.selection;
  const pixels = rasterInsideSelection(l.raster, l.offset, sel);
  const layer = createRasterLayer(d, { name: nextName(d, "Layer"), raster: pixels, offset: { ...l.offset } });
  const cmds: Command[] = [new AddLayerCommand(layer, undefined, cut ? "Layer Via Cut" : "Layer Via Copy")];
  if (cut && !sel.isEmpty) {
    const cleared = rasterInsideSelection(l.raster, l.offset, sel, true);
    cmds.unshift(ReplaceLayerPixelsCommand.whole("Layer Via Cut", l, cleared));
  }
  docStore.exec(new BatchCommand(cut ? "Layer Via Cut" : "Layer Via Copy", cmds));
  select([layer.id]);
}

// ---------------------------------------------------------------- delete / rename / properties

function deleteSelected(): void {
  const d = doc();
  const t = targets();
  if (!d || t.length === 0) return;
  if (t.length >= d.layers.length) {
    toast.info("A document needs at least one layer.");
    return;
  }
  if (t.length === 1) docStore.exec(new RemoveLayerCommand(t[0]!.id));
  else docStore.exec(new DeleteLayersCommand(t.map((l) => l.id), "Delete Layers"));
  layersUi.setSelection([]);
}

function deleteHidden(): void {
  const d = doc();
  if (!d) return;
  const hidden = d.layers.filter((l) => !l.visible).map((l) => l.id);
  if (hidden.length === 0) return;
  docStore.exec(new DeleteLayersCommand(hidden, "Delete Hidden Layers"));
  layersUi.setSelection([]);
}

async function properties(): Promise<void> {
  const l = active();
  if (!l) return;
  const r = await openDialog<{ name: string; color: Layer["color"]; isGroup: boolean }, Partial<LayerProps>>(LayerPropsDialog, { name: l.name, color: l.color, isGroup: l.kind === "group" });
  if (r) docStore.exec(new SetLayerPropsCommand(l.id, r, "Layer Properties"), { noMerge: true });
}

// ---------------------------------------------------------------- layer style

let styleClipboard: LayerEffects | null = null;

async function openStyle(page: StylePage): Promise<void> {
  const l = active();
  if (!l || l.kind === "group") return;
  await openDialog<{ layerId: string; page: StylePage }, boolean>(LayerStyleDialog, { layerId: l.id, page });
}

async function globalLight(): Promise<void> {
  const l = active();
  if (!l) return;
  const r = await openDialog<{ angle: number; altitude: number }, { angle: number; altitude: number }>(LayerStyleGlobalLightDialog, {
    angle: l.effects?.globalLightAngle ?? DEFAULT_GLOBAL_LIGHT_ANGLE,
    altitude: l.effects?.globalLightAltitude ?? DEFAULT_GLOBAL_LIGHT_ALTITUDE,
  });
  if (!r) return;
  // PS global light is per document: apply to every layer with effects.
  const d = doc()!;
  const cmds = d.layers.filter((x) => x.effects).map((x) => new SetLayerEffectsCommand(x.id, setGlobalLight(x.effects, r.angle, r.altitude), "Global Light"));
  if (cmds.length) docStore.exec(new BatchCommand("Global Light", cmds));
}

async function scaleFx(): Promise<void> {
  const l = active();
  if (!l?.effects) return;
  const pct = await openDialog<{ title: string; label: string; unit: string; min: number; max: number; initial: number }, number>(NumberDialog, { title: "Scale Layer Effects", label: "Scale", unit: "%", min: 1, max: 1000, initial: 100 });
  if (pct === null) return;
  docStore.exec(new SetLayerEffectsCommand(l.id, scaleEffects(l.effects, pct), "Scale Effects"), { noMerge: true });
}

// ---------------------------------------------------------------- fill / adjustment layers

async function newFill(kind: "solid" | "gradient" | "pattern"): Promise<void> {
  const d = doc();
  if (!d) return;
  const fg = toolStore.fg;
  const bg = toolStore.bg;
  let spec: FillSpec;
  if (kind === "solid") spec = solidFill({ ...fg });
  else if (kind === "gradient") spec = gradientFill([{ pos: 0, color: { ...fg } }, { pos: 1, color: { ...bg } }], { angle: 90 });
  else {
    const p = new Raster(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) p.setPixel(x, y, ((x >> 2) + (y >> 2)) % 2 === 0 ? { r: 40, g: 40, b: 40, a: 255 } : { r: 230, g: 230, b: 230, a: 255 });
    spec = patternFill(p);
  }
  const label = kind === "solid" ? "Color Fill" : kind === "gradient" ? "Gradient Fill" : "Pattern Fill";
  const props = await openDialog<{ title: string; name: string; canClip: boolean }, NewLayerResult>(NewLayerDialog, { title: "New Layer", name: nextName(d, label), canClip: !!active() });
  if (!props) return;
  const layer = createFillLayer(d, { fill: spec, name: props.name, blendMode: props.blendMode, opacity: props.opacity, color: props.color, clipToBelow: props.clip });
  if (hasSel()) layer.mask = maskFromSelection(d, layer, true);
  docStore.exec(new AddLayerCommand(layer, undefined, `New ${label} Layer`));
  select([layer.id]);
  const fill = await openDialog<{ fill: FillSpec; layerId: string }, FillSpec>(FillLayerDialog, { fill: spec, layerId: layer.id });
  if (fill) docStore.exec(new SetFillLayerCommand(layer.id, fill), { noMerge: true });
  // PS: cancelling the fill dialog of a brand-new fill layer removes the layer.
  else if (docStore.active?.history.undoLabel === `New ${label} Layer`) docStore.undo();
}

async function newAdjustment(opId: string): Promise<void> {
  const d = doc();
  if (!d) return;
  const op = ADJUSTMENT_OPS.find((o) => o.id === opId);
  if (!op) return;
  const props = await openDialog<{ title: string; name: string; canClip: boolean }, NewLayerResult>(NewLayerDialog, { title: "New Layer", name: nextName(d, op.label), canClip: !!active() });
  if (!props) return;
  const layer = createAdjustmentLayer(d, { op: op.id, name: props.name, blendMode: props.blendMode, opacity: props.opacity, color: props.color, clipToBelow: props.clip });
  layer.mask = hasSel() ? maskFromSelection(d, layer, true) : maskRevealAll(d, layer);
  docStore.exec(new AddLayerCommand(layer, undefined, `New ${op.label} Layer`));
  select([layer.id]);
  ui.activateTab("properties");
}

export const FILL_MENU: readonly { id: string; label: string }[] = [
  { id: "layer.fill.solid", label: "Solid Color…" },
  { id: "layer.fill.gradient", label: "Gradient…" },
  { id: "layer.fill.pattern", label: "Pattern…" },
];

export const ADJUSTMENT_MENU: readonly { id: string; label: string; op: string }[] = ADJUSTMENT_OPS.map((op) => ({ id: `layer.adjust.${op.id}`, label: `${op.label}…`, op: op.id }));

// ---------------------------------------------------------------- masks

function setMask(make: (d: Document, l: Layer) => Raster, label: string): void {
  const d = doc();
  const l = active();
  if (!d || !l || l.kind === "group") return;
  docStore.exec(new SetLayerMaskCommand(l.id, make(d, l), label));
  layersUi.maskTargeted = true;
}

function maskCmd(id: string, label: string, order: number, make: (d: Document, l: Layer) => Raster, needsSel = false): CommandDef {
  return {
    id,
    label,
    menu: "Layer/Layer Mask",
    order,
    enabled: () => {
      const l = active();
      return !!l && l.kind !== "group" && !l.mask && (!needsSel || hasSel());
    },
    run: () => setMask(make, `Add Layer Mask (${label})`),
  };
}

// ---------------------------------------------------------------- arrange

function moveActive(dir: "up" | "down" | "top" | "bottom"): void {
  const d = doc();
  const l = active();
  if (!d || !l) return;
  const sib = d.layers.filter((x) => x.parentId === l.parentId);
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
  const to = dir === "up" || dir === "top" ? tb.end - myLen : tb.start;
  docStore.exec(new ReorderLayerCommand(l.id, to));
}

function alignTarget(d: Document): Rect {
  return d.selection.bbox ?? Rect.ofSize(d.width, d.height);
}

function alignCmd(kind: AlignKind, label: string, order: number, icon: string): CommandDef {
  return {
    id: `layer.align.${kind}`,
    label,
    menu: "Layer/Align",
    order,
    keywords: [icon],
    enabled: () => targets().some((l) => l.kind !== "group" && l.kind !== "adjustment" && l.kind !== "fill"),
    run: () => {
      const d = doc();
      if (!d) return;
      const updates = alignOffsets(targets(), alignTarget(d), kind);
      if (updates.length) docStore.exec(offsetsCommand(`Align ${label}`, updates));
    },
  };
}

function distributeCmd(axis: "h" | "v", label: string, order: number): CommandDef {
  return {
    id: `layer.distribute.${axis}`,
    label,
    menu: "Layer/Distribute",
    order,
    enabled: () => targets().filter((l) => l.kind === "raster" || l.kind === "shape" || l.kind === "text").length >= 3,
    run: () => {
      const updates = distributeOffsets(targets(), axis);
      if (updates.length) docStore.exec(offsetsCommand(`Distribute ${label}`, updates));
    },
  };
}

// ---------------------------------------------------------------- lock / link

async function lockLayers(): Promise<void> {
  const t = targets();
  if (t.length === 0) return;
  const r = await openDialog<{ lock: LayerLock; count: number }, LayerLock>(LayerPropsLockDialog, { lock: { ...t[0]!.lock }, count: t.length });
  if (!r) return;
  docStore.exec(new BatchCommand("Lock Layers", t.map((l) => new SetLayerLockCommand(l.id, r))));
}

function linkLayers(): void {
  const t = targets();
  if (t.length >= 2) {
    const allLinked = t.every((l) => t.every((o) => o === l || l.linkedTo.includes(o.id)));
    docStore.exec(new LinkLayersCommand(t.map((l) => l.id), !allLinked));
  } else if (t[0]?.linkedTo.length) {
    docStore.exec(new LinkLayersCommand([t[0].id], false));
  }
}

function selectLinked(): void {
  const l = active();
  if (!l) return;
  select([l.id, ...l.linkedTo]);
}

// ---------------------------------------------------------------- matting

function matting(kind: "defringe" | "black" | "white", px = 1): void {
  const l = activePixel();
  if (!l) return;
  const out = kind === "defringe" ? defringe(l.raster, px) : removeMatte(l.raster, kind);
  docStore.exec(ReplaceLayerPixelsCommand.whole(kind === "defringe" ? "Defringe" : kind === "black" ? "Remove Black Matte" : "Remove White Matte", l, out));
}

// ---------------------------------------------------------------- registration

registerCommands([
  // New ▸
  { id: "layer.new", label: "Layer…", menu: "Layer/New", order: 100, shortcut: "CmdOrCtrl+Shift+N", keywords: ["new layer"], enabled: hasDoc, run: newLayerDialog },
  { id: "layer.newQuick", label: "New Layer (no dialog)", shortcut: "CmdOrCtrl+Alt+Shift+N", keywords: ["new layer"], enabled: hasDoc, run: newLayerQuick },
  { id: "layer.fromBackground", label: "Layer from Background…", menu: "Layer/New", order: 101, enabled: isBackground, run: layerFromBackground },
  { id: "layer.newGroup", label: "Group…", menu: "Layer/New", order: 102, enabled: hasDoc, run: newGroup },
  { id: "layer.groupFromLayers", label: "Group from Layers…", menu: "Layer/New", order: 103, enabled: () => targets().length > 0 && targets().every((l) => l.kind !== "group" && l.parentId === null), run: groupFromLayers },
  { id: "layer.viaCopy", label: "Layer Via Copy", menu: "Layer/New", order: 200, shortcut: "CmdOrCtrl+J", enabled: () => !!activePixel(), run: () => layerVia(false) },
  { id: "layer.viaCut", label: "Layer Via Cut", menu: "Layer/New", order: 201, shortcut: "CmdOrCtrl+Shift+J", enabled: () => !!activePixel() && hasSel(), run: () => layerVia(true) },

  { id: "layer.duplicate", label: "Duplicate Layer…", menu: "Layer", order: 110, enabled: hasActive, run: () => { const t = targets(); if (t.length === 1) { const c = new DuplicateLayerCommand(t[0]!.id); docStore.exec(c); select(c.copyIds.slice(0, 1)); } else if (t.length > 1) { const cmds = t.map((l) => new DuplicateLayerCommand(l.id)); docStore.exec(new BatchCommand("Duplicate Layers", cmds)); select(cmds.map((c) => c.copyIds[0]!)); } } },
  { id: "layer.delete", label: "Layer", menu: "Layer/Delete", order: 120, enabled: () => hasActive() && (doc()?.layers.length ?? 0) > targets().length, run: deleteSelected },
  { id: "layer.deleteHidden", label: "Hidden Layers", menu: "Layer/Delete", order: 121, enabled: () => !!doc()?.layers.some((l) => !l.visible), run: deleteHidden },
  { id: "layer.rename", label: "Rename Layer…", menu: "Layer", order: 140, enabled: hasActive, run: () => { const l = active(); if (l) { ui.activateTab("layers"); layersUi.renameRequest = l.id; } } },
  { id: "layer.properties", label: "Layer Properties…", keywords: ["layer color", "group properties"], enabled: hasActive, run: properties },

  // Layer Style ▸
  { id: "layer.style", label: "Blending Options…", menu: "Layer/Layer Style", order: 150, enabled: () => !!active() && active()!.kind !== "group", run: () => openStyle("blending") },
  ...STYLE_PAGES.map((k, i): CommandDef => ({ id: `layer.style.${k}`, label: `${STYLE_LABEL[k]}…`, menu: "Layer/Layer Style", order: 151 + i, enabled: () => !!active() && active()!.kind !== "group", run: () => openStyle(k) })),
  { id: "layer.style.copy", label: "Copy Layer Style", menu: "Layer/Layer Style", order: 200, enabled: () => !!active()?.effects, run: () => { styleClipboard = cloneEffects(active()?.effects ?? null); } },
  { id: "layer.style.paste", label: "Paste Layer Style", menu: "Layer/Layer Style", order: 201, enabled: () => !!styleClipboard && targets().some((l) => l.kind !== "group"), run: () => { const cmds = targets().filter((l) => l.kind !== "group").map((l) => new SetLayerEffectsCommand(l.id, cloneEffects(styleClipboard), "Paste Layer Style")); if (cmds.length) docStore.exec(new BatchCommand("Paste Layer Style", cmds)); } },
  { id: "layer.style.clear", label: "Clear Layer Style", menu: "Layer/Layer Style", order: 202, enabled: () => targets().some((l) => !!l.effects), run: () => { const cmds = targets().filter((l) => l.effects).map((l) => new SetLayerEffectsCommand(l.id, null, "Clear Layer Style")); docStore.exec(new BatchCommand("Clear Layer Style", cmds)); } },
  { id: "layer.style.globalLight", label: "Global Light…", menu: "Layer/Layer Style", order: 300, enabled: hasActive, run: globalLight },
  { id: "layer.style.scale", label: "Scale Effects…", menu: "Layer/Layer Style", order: 301, enabled: () => !!active()?.effects, run: scaleFx },

  // New Fill Layer ▸ / New Adjustment Layer ▸
  { id: "layer.fill.solid", label: "Solid Color…", menu: "Layer/New Fill Layer", order: 160, enabled: hasDoc, run: () => newFill("solid") },
  { id: "layer.fill.gradient", label: "Gradient…", menu: "Layer/New Fill Layer", order: 161, enabled: hasDoc, run: () => newFill("gradient") },
  { id: "layer.fill.pattern", label: "Pattern…", menu: "Layer/New Fill Layer", order: 162, enabled: hasDoc, run: () => newFill("pattern") },
  ...ADJUSTMENT_MENU.map((a, i): CommandDef => ({ id: a.id, label: a.label, menu: "Layer/New Adjustment Layer", order: 170 + i, keywords: ["adjustment layer"], enabled: hasDoc, run: () => newAdjustment(a.op) })),
  { id: "layer.editAdjustment", label: "Edit Adjustment", keywords: ["properties"], enabled: () => active()?.kind === "adjustment", run: () => ui.activateTab("properties") },

  // Layer Mask ▸
  maskCmd("layer.mask.revealAll", "Reveal All", 180, (d, l) => maskRevealAll(d, l)),
  maskCmd("layer.mask.hideAll", "Hide All", 181, (d, l) => maskHideAll(d, l)),
  maskCmd("layer.mask.revealSelection", "Reveal Selection", 182, (d, l) => maskFromSelection(d, l, true), true),
  maskCmd("layer.mask.hideSelection", "Hide Selection", 183, (d, l) => maskFromSelection(d, l, false), true),
  { id: "layer.mask.delete", label: "Delete", menu: "Layer/Layer Mask", order: 200, enabled: () => !!active()?.mask, run: () => { const l = active(); if (l?.mask) { docStore.exec(new SetLayerMaskCommand(l.id, null)); layersUi.maskTargeted = false; } } },
  { id: "layer.mask.apply", label: "Apply", menu: "Layer/Layer Mask", order: 201, enabled: () => !!activePixel()?.mask, run: () => { const l = activePixel(); if (l?.mask) { docStore.exec(new ApplyMaskCommand(l.id)); layersUi.maskTargeted = false; } } },
  { id: "layer.mask.toggle", label: "Disable", menu: "Layer/Layer Mask", order: 300, enabled: () => !!active()?.mask, checked: () => !!active()?.mask && !active()!.maskEnabled, run: () => { const l = active(); if (l?.mask) docStore.exec(new SetMaskEnabledCommand(l.id, !l.maskEnabled)); } },
  { id: "layer.mask.link", label: "Unlink", menu: "Layer/Layer Mask", order: 301, enabled: () => !!active()?.mask, checked: () => !!active()?.mask && !active()!.maskLinked, run: () => { const l = active(); if (l?.mask) docStore.exec(new SetMaskLinkedCommand(l.id, !l.maskLinked)); } },
  { id: "layer.vectorMask", label: "Vector Mask", menu: "Layer", order: 190, enabled: () => false, run: () => {} },
  { id: "layer.clipping", label: "Create Clipping Mask", menu: "Layer", order: 191, shortcut: "CmdOrCtrl+Alt+G", checked: () => !!active()?.clipToBelow, enabled: () => { const d = doc(); const l = active(); return !!d && !!l && (l.clipToBelow || canClip(d, l)); }, run: () => { const l = active(); if (l) docStore.exec(new SetClipToBelowCommand(l.id, !l.clipToBelow)); } },

  // Rasterize ▸
  { id: "layer.rasterize.type", label: "Type", menu: "Layer/Rasterize", order: 200, enabled: () => targets().some((l) => l.kind === "text"), run: () => docStore.exec(new RasterizeLayerCommand(targets().filter((l) => l.kind === "text").map((l) => l.id), "Rasterize Type")) },
  { id: "layer.rasterize.shape", label: "Shape", menu: "Layer/Rasterize", order: 201, enabled: () => targets().some((l) => l.kind === "shape"), run: () => docStore.exec(new RasterizeLayerCommand(targets().filter((l) => l.kind === "shape").map((l) => l.id), "Rasterize Shape")) },
  { id: "layer.rasterize.fill", label: "Fill Content", menu: "Layer/Rasterize", order: 202, enabled: () => targets().some((l) => l.kind === "fill"), run: () => docStore.exec(new RasterizeLayerCommand(targets().filter((l) => l.kind === "fill").map((l) => l.id), "Rasterize Fill Content")) },
  { id: "layer.rasterize.layer", label: "Layer", menu: "Layer/Rasterize", order: 203, enabled: () => targets().some((l) => l.kind === "text" || l.kind === "shape" || l.kind === "fill"), run: () => docStore.exec(new RasterizeLayerCommand(targets().map((l) => l.id))) },

  // Group / ungroup / hide
  { id: "layer.group", label: "Group Layers", menu: "Layer", order: 210, shortcut: "CmdOrCtrl+G", enabled: () => targets().length > 0 && targets().every((l) => l.kind !== "group" && l.parentId === null), run: groupFromLayers },
  { id: "layer.ungroup", label: "Ungroup Layers", menu: "Layer", order: 211, shortcut: "CmdOrCtrl+Shift+G", enabled: () => { const l = active(); return !!l && (l.kind === "group" || l.parentId !== null); }, run: () => { const l = active(); const gid = l ? (l.kind === "group" ? l.id : l.parentId) : null; if (gid) docStore.exec(new UngroupLayersCommand(gid)); } },
  { id: "layer.hide", label: "Hide Layers", menu: "Layer", order: 212, shortcut: "CmdOrCtrl+,", enabled: hasActive, run: () => { const t = targets(); const anyVisible = t.some((l) => l.visible); const next: Record<string, boolean> = {}; for (const l of t) next[l.id] = !anyVisible; docStore.exec(new SetLayersVisibleCommand(next, anyVisible ? "Hide Layers" : "Show Layers")); } },

  // Arrange ▸
  { id: "layer.bringToFront", label: "Bring to Front", menu: "Layer/Arrange", order: 220, shortcut: "CmdOrCtrl+Shift+]", enabled: hasActive, run: () => moveActive("top") },
  { id: "layer.bringForward", label: "Bring Forward", menu: "Layer/Arrange", order: 221, shortcut: "CmdOrCtrl+]", enabled: hasActive, run: () => moveActive("up") },
  { id: "layer.sendBackward", label: "Send Backward", menu: "Layer/Arrange", order: 222, shortcut: "CmdOrCtrl+[", enabled: hasActive, run: () => moveActive("down") },
  { id: "layer.sendToBack", label: "Send to Back", menu: "Layer/Arrange", order: 223, shortcut: "CmdOrCtrl+Shift+[", enabled: hasActive, run: () => moveActive("bottom") },

  // Align ▸ / Distribute ▸
  alignCmd("top", "Top Edges", 230, "align-top"),
  alignCmd("vcenter", "Vertical Centers", 231, "align-vcenter"),
  alignCmd("bottom", "Bottom Edges", 232, "align-bottom"),
  alignCmd("left", "Left Edges", 233, "align-left"),
  alignCmd("hcenter", "Horizontal Centers", 234, "align-hcenter"),
  alignCmd("right", "Right Edges", 235, "align-right"),
  distributeCmd("v", "Vertical Centers", 240),
  distributeCmd("h", "Horizontal Centers", 241),

  // Lock / link
  { id: "layer.lock", label: "Lock Layers…", menu: "Layer", order: 250, shortcut: "CmdOrCtrl+/", keywords: ["lock all"], enabled: hasActive, run: lockLayers },
  { id: "layer.link", label: "Link Layers", menu: "Layer", order: 251, enabled: () => targets().length >= 2 || !!active()?.linkedTo.length, run: linkLayers },
  { id: "layer.selectLinked", label: "Select Linked Layers", menu: "Layer", order: 252, enabled: () => !!active()?.linkedTo.length, run: selectLinked },

  // Merge / flatten
  { id: "layer.mergeDown", label: "Merge Down", menu: "Layer", order: 260, shortcut: "CmdOrCtrl+E", enabled: () => { const d = doc(); const l = active(); return !!d && !!l && canMergeDown(d, l); }, run: () => { dropOverlay(); const d = doc(); const l = active(); if (d && l && canMergeDown(d, l)) docStore.exec(new MergeDownCommand(l.id)); } },
  { id: "layer.mergeVisible", label: "Merge Visible", menu: "Layer", order: 261, shortcut: "CmdOrCtrl+Shift+E", enabled: () => (doc()?.layers.filter((l) => l.visible).length ?? 0) > 1, run: () => { dropOverlay(); if ((doc()?.layers.length ?? 0) > 1) docStore.exec(new MergeVisibleCommand()); } },
  { id: "layer.flatten", label: "Flatten Image", menu: "Layer", order: 262, enabled: () => (doc()?.layers.length ?? 0) > 1, run: () => { dropOverlay(); if ((doc()?.layers.length ?? 0) > 1) docStore.exec(new FlattenCommand()); } },

  // Matting ▸
  { id: "layer.matting.defringe", label: "Defringe…", menu: "Layer/Matting", order: 270, enabled: () => !!activePixel(), run: async () => { const px = await openDialog<{ title: string; label: string; unit: string; min: number; max: number; initial: number }, number>(NumberDialog, { title: "Defringe", label: "Width", unit: "pixels", min: 1, max: 200, initial: 1 }); if (px !== null) matting("defringe", Math.round(px)); } },
  { id: "layer.matting.black", label: "Remove Black Matte", menu: "Layer/Matting", order: 271, enabled: () => !!activePixel(), run: () => matting("black") },
  { id: "layer.matting.white", label: "Remove White Matte", menu: "Layer/Matting", order: 272, enabled: () => !!activePixel(), run: () => matting("white") },

  // Palette-only legacy ids
  { id: "layer.flipH", label: "Flip layer horizontal", keywords: ["transform"], enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(flipLayerCommand(d, l.id, "h")); } },
  { id: "layer.flipV", label: "Flip layer vertical", keywords: ["transform"], enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(flipLayerCommand(d, l.id, "v")); } },
  { id: "layer.rotateCW", label: "Rotate layer 90° clockwise", keywords: ["transform"], enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(rotateLayer90Command(d, l.id, true)); } },
  { id: "layer.rotateCCW", label: "Rotate layer 90° counter-clockwise", keywords: ["transform"], enabled: () => !!activeRaster(), run: () => { const d = doc(); const l = activeRaster(); if (d && l) docStore.exec(rotateLayer90Command(d, l.id, false)); } },
  { id: "layer.toggleVisible", label: "Show / hide layer", enabled: hasActive, run: () => { const l = active(); if (l) docStore.exec(new SetLayerPropsCommand(l.id, { visible: !l.visible })); } },
  { id: "layer.toggleLock", label: "Lock / unlock layer", enabled: hasActive, run: () => { const l = active(); if (l) docStore.exec(new SetLayerLockCommand(l.id, { all: !l.lock.all })); } },
  { id: "layer.panelOptions", label: "Layers Panel Options…", keywords: ["thumbnail size"], run: async () => { await openDialog<Record<string, never>, boolean>(LayersPanelOptionsDialog, {}); } },
]);

/** Layers panel ≡ menu (PS order; the Dock appends Collapse / Close itself). */
export const LAYERS_PANEL_MENU_IDS: readonly string[] = [
  "layer.new",
  "layer.duplicate",
  "layer.delete",
  "layer.deleteHidden",
  "layer.newGroup",
  "layer.groupFromLayers",
  "layer.lock",
  "layer.style",
  "layer.clipping",
  "layer.link",
  "layer.selectLinked",
  "layer.mergeDown",
  "layer.mergeVisible",
  "layer.flatten",
  "layer.panelOptions",
];
