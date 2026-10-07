/**
 * Edit menu — Photoshop order: Undo / Redo / Toggle Last State │ Step Forward / Step
 * Backward │ Cut / Copy / Copy Merged / Paste / Paste Special ▸ / Clear │ Search │ Fill… /
 * Stroke… │ Free Transform (filters owns it; re-ordered here) / Transform ▸ │ Define
 * Brush Preset… / Define Pattern… / Purge ▸ │ Preferences ▸ (shell).
 */
import {
  AddLayerCommand,
  PaintCommand,
  Rect,
  Raster,
  Selection,
  TransformLayerCommand,
  activeLayer,
  compositeToRaster,
  createRasterLayer,
  flipLayerCommand,
  maskFromSelection,
  rotateLayer90Command,
  type Document,
  type RGBA,
  type RasterLayer,
} from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { toast, errorMessage } from "$lib/stores/toast.svelte";
import { getCommand, registerCommand, registerCommands, runCommand } from "../registry.svelte";
import { openDialog } from "../dialogs/dialogs.svelte";
import FillDialog from "../dialogs/FillDialog.svelte";
import StrokeDialog from "../dialogs/StrokeDialog.svelte";
import HistorySnapshotDialog from "../panels/HistorySnapshotDialog.svelte";
import { copyRegion, readRasterFromClipboard, writeRasterToClipboard } from "$lib/io/clipboard";
import { withoutDiffOverlays } from "$lib/ai/overlay";
import { clearThroughMask, fillThroughMask } from "$lib/tools/paint/fill";
import { patternById } from "$lib/tools/patterns";
import { tipFromRaster } from "$lib/tools/brush-tips";
import { brushStore } from "$lib/tools/brush-store.svelte";
import { nextUntitledName } from "./file";
import {
  DEFAULT_FILL,
  DEFAULT_STROKE,
  definePattern,
  fillLabel,
  fillPixels,
  fillSolidColor,
  getUserPatterns,
  patternSource,
  strokeBand,
  type FillOptions,
  type StrokeOptions,
} from "./fill-stroke";

function paintable(): { doc: Document; layer: RasterLayer } | null {
  const doc = docStore.doc;
  const l = doc ? activeLayer(doc) : undefined;
  if (!doc || !l) return null;
  if (l.kind !== "raster") {
    toast.info(`"${l.name}" is not a pixel layer.`, "Rasterize it first (Layer ▸ Rasterize).");
    return null;
  }
  if (l.locked || l.lock.all || l.lock.pixels) {
    toast.info(`"${l.name}" is locked.`);
    return null;
  }
  return { doc, layer: l };
}

/** Fill the selection (or whole layer) with a color. */
export function fillWith(color: RGBA, label: string): void {
  const p = paintable();
  if (!p) return;
  const { doc, layer } = p;
  const mask = doc.selection.isEmpty ? Selection.all(doc.width, doc.height) : doc.selection;
  const bb = mask.bbox!;
  const target = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
  if (Rect.isEmpty(target)) return;
  const captured = PaintCommand.capture(layer, target);
  const touched = fillThroughMask(layer.raster, mask, layer.offset, color);
  if (touched) docStore.exec(PaintCommand.finish(layer, captured, label, touched), { alreadyApplied: true, noMerge: true });
}

export function clearSelection(): void {
  const p = paintable();
  if (!p) return;
  const { doc, layer } = p;
  const mask = doc.selection.isEmpty ? Selection.all(doc.width, doc.height) : doc.selection;
  const bb = mask.bbox!;
  const target = Rect.intersect(Rect.translate(bb, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
  if (Rect.isEmpty(target)) return;
  const captured = PaintCommand.capture(layer, target);
  const touched = clearThroughMask(layer.raster, mask, layer.offset);
  if (touched) docStore.exec(PaintCommand.finish(layer, captured, "Clear", touched), { alreadyApplied: true, noMerge: true });
}

/** Where the last Copy came from (Paste in Place puts it back there). */
let lastCopyOrigin: { x: number; y: number } | null = null;

export async function copy(merged = false): Promise<boolean> {
  const doc = docStore.doc;
  if (!doc) return false;
  const clean = withoutDiffOverlays(doc);
  let region = merged && doc.selection.isEmpty ? { raster: compositeToRaster(clean), origin: { x: 0, y: 0 } } : copyRegion(clean, { layerOnly: !merged });
  if (!region) {
    toast.info("Nothing to copy — the layer is empty.");
    return false;
  }
  if (merged && !doc.selection.isEmpty) region = copyRegion(clean) ?? region;
  try {
    await writeRasterToClipboard(region.raster);
    lastCopyOrigin = region.origin;
    toast.success(merged ? "Copied merged" : "Copied", `${region.raster.width} × ${region.raster.height} px`);
    return true;
  } catch (e) {
    toast.error("Copy failed", errorMessage(e));
    return false;
  }
}

export type PasteMode = "center" | "inPlace" | "into";

export async function paste(mode: PasteMode = "center"): Promise<void> {
  let raster;
  try {
    raster = await readRasterFromClipboard();
  } catch (e) {
    toast.error("Paste failed", errorMessage(e));
    return;
  }
  if (!raster) {
    toast.info("The clipboard has no image.");
    return;
  }
  const entry = docStore.active;
  if (!entry) {
    const doc = docStore.create({ name: nextUntitledName(), width: raster.width, height: raster.height, noBackgroundLayer: true });
    const layer = createRasterLayer(doc.doc, { name: "Background", raster });
    doc.doc.layers.push(layer);
    doc.doc.activeLayerId = layer.id;
    doc.version++;
    return;
  }
  const doc = entry.doc;
  const sel = doc.selection;
  let offset = { x: Math.round((doc.width - raster.width) / 2), y: Math.round((doc.height - raster.height) / 2) };
  if (mode === "inPlace" && lastCopyOrigin) offset = { ...lastCopyOrigin };
  else if (mode === "into" && !sel.isEmpty) {
    const bb = sel.bbox!;
    offset = { x: Math.round(bb.x + (bb.w - raster.width) / 2), y: Math.round(bb.y + (bb.h - raster.height) / 2) };
  } else if (!sel.isEmpty && mode === "center") {
    const bb = sel.bbox!;
    offset = { x: Math.round(bb.x + (bb.w - raster.width) / 2), y: Math.round(bb.y + (bb.h - raster.height) / 2) };
  }
  const layer = createRasterLayer(doc, { name: mode === "into" ? "Pasted Into" : "Pasted", raster, offset });
  if (mode === "into") {
    if (sel.isEmpty) {
      toast.info("Paste Into needs a selection.");
      return;
    }
    layer.mask = maskFromSelection(doc, layer, true);
    layer.maskEnabled = true;
    layer.maskLinked = false;
  }
  docStore.exec(new AddLayerCommand(layer, undefined, mode === "into" ? "Paste Into" : "Paste"));
  if (mode === "center" && (raster.width > doc.width || raster.height > doc.height)) toast.info("The pasted image is larger than the canvas — use Move to position it.");
}

// ---------------------------------------------------------------------------- undo family

function bump(e: OpenDoc): void {
  e.compositor?.invalidateAll();
}

/** Toggle Last State: undo the newest step; again re-does it. */
export function toggleLastState(): void {
  const e = docStore.active;
  if (!e) return;
  const h = e.history;
  if (h.canRedo && h.index === h.entries.length - 1) docStore.redo();
  else if (h.canUndo) docStore.undo();
  bump(e);
}

// ---------------------------------------------------------------------------- Fill / Stroke

let lastFill: FillOptions = { ...DEFAULT_FILL };
let lastStroke: StrokeOptions = { ...DEFAULT_STROKE };

/** Apply `FillOptions` to the active pixel layer through the selection (whole layer when none). */
export function applyFill(o: FillOptions): boolean {
  const p = paintable();
  const entry = docStore.active;
  if (!p || !entry) return false;
  const { doc, layer } = p;
  const sel = doc.selection.isEmpty ? null : doc.selection;
  const area = sel ? Rect.intersect(Rect.translate(sel.bbox!, -layer.offset.x, -layer.offset.y), layer.raster.bounds()) : layer.raster.bounds();
  if (Rect.isEmpty(area)) return false;
  let source: (x: number, y: number) => RGBA;
  const solid = fillSolidColor(o.contents, toolStore.fg, toolStore.bg, o.color);
  if (solid) source = () => solid;
  else if (o.contents === "pattern") {
    const user = getUserPatterns().find((u) => u.id === o.patternId);
    source = patternSource(user ? user.raster : patternById(o.patternId).raster);
  } else {
    const hist = entry.history.rasterFromSource(toolStore.historySource ?? { kind: "state", index: 0 }, layer.id);
    if (!hist) {
      toast.info("The history source has no pixels for this layer.");
      return false;
    }
    const out: RGBA = { r: 0, g: 0, b: 0, a: 0 };
    source = (x, y) => hist.getPixel(x - layer.offset.x, y - layer.offset.y, out);
  }
  try {
    const captured = PaintCommand.capture(layer, area);
    const touched = fillPixels(layer.raster, layer.offset, area, sel ? (x, y) => sel.get(x, y) / 255 : () => 1, source, { mode: o.mode, opacity: o.opacity / 100, preserve: o.preserveTransparency });
    if (!touched) return false;
    docStore.exec(PaintCommand.finish(layer, captured, fillLabel(o), touched), { alreadyApplied: true, noMerge: true });
    return true;
  } catch (e) {
    toast.error("Fill failed", errorMessage(e));
    return false;
  }
}

/** Stroke the selection edge (or the layer's opaque pixels when nothing is selected). */
export function applyStroke(o: StrokeOptions): boolean {
  const p = paintable();
  if (!p) return false;
  const { doc, layer } = p;
  const sel = doc.selection.isEmpty ? Selection.fromLayerAlpha(layer.raster, { size: { w: doc.width, h: doc.height }, offset: layer.offset }) : doc.selection;
  const bb = sel.bbox;
  if (!bb) {
    toast.info("Nothing to stroke — make a selection first.");
    return false;
  }
  const { rect, band } = strokeBand(sel.mask, doc.width, doc.height, bb, o.width, o.location);
  const area = Rect.intersect(Rect.translate(rect, -layer.offset.x, -layer.offset.y), layer.raster.bounds());
  if (Rect.isEmpty(area)) return false;
  const color = { ...o.color, a: 255 };
  try {
    const captured = PaintCommand.capture(layer, area);
    const cov = (x: number, y: number): number => {
      const bx = x - rect.x;
      const by = y - rect.y;
      return bx < 0 || by < 0 || bx >= rect.w || by >= rect.h ? 0 : band[by * rect.w + bx]!;
    };
    const touched = fillPixels(layer.raster, layer.offset, area, cov, () => color, { mode: o.mode, opacity: o.opacity / 100, preserve: o.preserveTransparency });
    if (!touched) return false;
    docStore.exec(PaintCommand.finish(layer, captured, "Stroke", touched), { alreadyApplied: true, noMerge: true });
    return true;
  } catch (e) {
    toast.error("Stroke failed", errorMessage(e));
    return false;
  }
}

export async function fillDialog(): Promise<void> {
  if (!paintable()) return;
  const r = await openDialog<{ initial: FillOptions }, FillOptions>(FillDialog, { initial: lastFill });
  if (!r) return;
  lastFill = r;
  applyFill(r);
}

export async function strokeDialog(): Promise<void> {
  if (!paintable()) return;
  const r = await openDialog<{ initial: StrokeOptions }, StrokeOptions>(StrokeDialog, { initial: { ...lastStroke, color: lastStroke === DEFAULT_STROKE ? { ...toolStore.fg } : lastStroke.color } });
  if (!r) return;
  lastStroke = r;
  applyStroke(r);
}

// ---------------------------------------------------------------------------- Transform ▸

type LayerTransform = "flipH" | "flipV" | "rot90cw" | "rot90ccw" | "rot180";
let lastTransform: LayerTransform | null = null;

function pixelLayerId(): string | null {
  const l = docStore.activeLayer;
  return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l.id : null;
}

export function transformLayer(kind: LayerTransform): void {
  const doc = docStore.doc;
  const id = pixelLayerId();
  if (!doc || !id) return;
  try {
    let cmd: TransformLayerCommand;
    if (kind === "flipH" || kind === "flipV") cmd = flipLayerCommand(doc, id, kind === "flipH" ? "h" : "v");
    else if (kind === "rot180") {
      const l = activeLayer(doc) as RasterLayer;
      const m = l.mask && l.maskLinked ? l.mask.flipH().flipV() : undefined;
      cmd = new TransformLayerCommand(id, l.raster.flipH().flipV(), l.offset, "Rotate 180°", m);
    } else cmd = rotateLayer90Command(doc, id, kind === "rot90cw");
    docStore.exec(cmd);
    docStore.active?.compositor?.markDirty(id);
    lastTransform = kind;
  } catch (e) {
    toast.error("Transform failed", errorMessage(e));
  }
}

// ---------------------------------------------------------------------------- Define…

function definitionSource(): Raster | null {
  const doc = docStore.doc;
  if (!doc) return null;
  const clean = withoutDiffOverlays(doc);
  if (!doc.selection.isEmpty) {
    const bb = doc.selection.bbox!;
    return compositeToRaster(clean, { rect: bb }).crop(bb);
  }
  return compositeToRaster(clean);
}

async function askName(title: string, initial: string): Promise<string | null> {
  return openDialog<{ title: string; label: string; initial: string; okLabel: string }, string>(HistorySnapshotDialog, { title, label: "Name:", initial, okLabel: "OK" });
}

export async function defineBrushPreset(): Promise<void> {
  const src = definitionSource();
  if (!src) return;
  if (src.width > 2500 || src.height > 2500) {
    toast.info("Select an area of 2500 × 2500 px or less to define a brush.");
    return;
  }
  const name = await askName("Brush Name", `Sampled Brush ${brushStore.userPresets.length + 1}`);
  if (name === null) return;
  const id = `sampled-${Date.now().toString(36)}`;
  tipFromRaster(id, name, src);
  brushStore.update({ tip: id, size: Math.max(src.width, src.height) });
  brushStore.saveAsPreset(name);
  toast.success("Brush preset defined", `${name} — ${src.width} × ${src.height} px (tip kept until the app closes)`);
}

export async function definePatternFromSelection(): Promise<void> {
  const src = definitionSource();
  if (!src) return;
  const name = await askName("Pattern Name", `Pattern ${getUserPatterns().length + 1}`);
  if (name === null) return;
  definePattern(name, src);
  toast.success("Pattern defined", `${name} — ${src.width} × ${src.height} px (available in Fill until the app closes)`);
}

// ---------------------------------------------------------------------------- Purge ▸

function purge(what: "undo" | "histories" | "all"): void {
  const targets = what === "undo" ? (docStore.active ? [docStore.active] : []) : docStore.docs;
  for (const e of targets) {
    e.history.clear();
    e.version++;
  }
  if (what === "all") lastCopyOrigin = null;
  toast.info(what === "undo" ? "Undo purged." : what === "histories" ? "All histories purged." : "Undo, histories and clipboard origin purged.");
}

const hasDoc = (): boolean => !!docStore.doc;
const hasPixelLayer = (): boolean => pixelLayerId() !== null;

registerCommands([
  { id: "edit.undo", label: "Undo", menu: "Edit", order: 100, shortcut: "CmdOrCtrl+Z", enabled: () => !!docStore.active?.history.canUndo, run: () => docStore.undo() },
  { id: "edit.redo", label: "Redo", menu: "Edit", order: 101, shortcut: "CmdOrCtrl+Y", enabled: () => !!docStore.active?.history.canRedo, run: () => docStore.redo() },
  { id: "edit.redoAlt", label: "Redo", enabled: () => !!docStore.active?.history.canRedo, run: () => docStore.redo() },
  { id: "edit.toggleLastState", label: "Toggle Last State", menu: "Edit", order: 102, keywords: ["undo", "redo"], enabled: () => !!docStore.active && (docStore.active.history.canUndo || docStore.active.history.canRedo), run: toggleLastState },
  { id: "edit.stepForward", label: "Step Forward", menu: "Edit", order: 200, shortcut: "CmdOrCtrl+Shift+Z", keywords: ["redo"], enabled: () => !!docStore.active?.history.canRedo, run: () => docStore.redo() },
  { id: "edit.stepBackward", label: "Step Backward", menu: "Edit", order: 201, shortcut: "CmdOrCtrl+Alt+Z", keywords: ["undo"], enabled: () => !!docStore.active?.history.canUndo, run: () => docStore.undo() },

  { id: "edit.cut", label: "Cut", menu: "Edit", order: 400, shortcut: "CmdOrCtrl+X", enabled: hasDoc, run: async () => { if (await copy()) clearSelection(); } },
  { id: "edit.copy", label: "Copy", menu: "Edit", order: 401, shortcut: "CmdOrCtrl+C", enabled: hasDoc, run: () => copy().then(() => {}) },
  { id: "edit.copyMerged", label: "Copy Merged", menu: "Edit", order: 402, shortcut: "CmdOrCtrl+Shift+C", keywords: ["composite", "flattened"], enabled: hasDoc, run: () => copy(true).then(() => {}) },
  { id: "edit.paste", label: "Paste", menu: "Edit", order: 403, shortcut: "CmdOrCtrl+V", keywords: ["clipboard"], run: () => paste("center") },
  { id: "edit.pasteInPlace", label: "Paste in Place", menu: "Edit/Paste Special", order: 404, shortcut: "CmdOrCtrl+Shift+V", enabled: hasDoc, run: () => paste("inPlace") },
  { id: "edit.pasteInto", label: "Paste Into", menu: "Edit/Paste Special", order: 405, shortcut: "CmdOrCtrl+Alt+Shift+V", keywords: ["mask"], enabled: () => !!docStore.doc && !docStore.doc.selection.isEmpty, run: () => paste("into") },
  { id: "edit.clear", label: "Clear", menu: "Edit", order: 406, shortcut: "Delete", keywords: ["erase", "delete pixels"], enabled: hasDoc, run: clearSelection },

  { id: "edit.search", label: "Search", menu: "Edit", order: 500, keywords: ["find", "command palette"], run: () => { ui.paletteOpen = true; } },

  { id: "edit.fill", label: "Fill…", menu: "Edit", order: 600, shortcut: "Shift+F5", keywords: ["foreground", "pattern", "history"], enabled: hasDoc, run: fillDialog },
  { id: "edit.stroke", label: "Stroke…", menu: "Edit", order: 601, keywords: ["outline", "border"], enabled: hasDoc, run: strokeDialog },
  { id: "edit.fillFg", label: "Fill with foreground", shortcut: "Alt+Backspace", enabled: hasDoc, run: () => fillWith(toolStore.fg, "Fill") },
  { id: "edit.fillBg", label: "Fill with background", shortcut: "CmdOrCtrl+Backspace", enabled: hasDoc, run: () => fillWith(toolStore.bg, "Fill") },
  { id: "edit.fillFgAlt", label: "Fill with foreground", enabled: hasDoc, run: () => fillWith(toolStore.fg, "Fill") },

  { id: "edit.transform.again", label: "Again", menu: "Edit/Transform", order: 701, shortcut: "CmdOrCtrl+Shift+T", enabled: () => hasPixelLayer() && lastTransform !== null, run: () => { if (lastTransform) transformLayer(lastTransform); } },
  { id: "edit.transform.scale", label: "Scale", menu: "Edit/Transform", order: 702, enabled: hasPixelLayer, run: () => void runCommand("edit.transform") },
  { id: "edit.transform.rotate", label: "Rotate", menu: "Edit/Transform", order: 703, enabled: hasPixelLayer, run: () => void runCommand("edit.transform") },
  { id: "edit.transform.skew", label: "Skew", menu: "Edit/Transform", order: 704, enabled: () => false, run: () => {} },
  { id: "edit.transform.rotate180", label: "Rotate 180°", menu: "Edit/Transform", order: 710, enabled: hasPixelLayer, run: () => transformLayer("rot180") },
  { id: "edit.transform.rotate90cw", label: "Rotate 90° Clockwise", menu: "Edit/Transform", order: 711, enabled: hasPixelLayer, run: () => transformLayer("rot90cw") },
  { id: "edit.transform.rotate90ccw", label: "Rotate 90° Counter Clockwise", menu: "Edit/Transform", order: 712, enabled: hasPixelLayer, run: () => transformLayer("rot90ccw") },
  { id: "edit.transform.flipH", label: "Flip Horizontal", menu: "Edit/Transform", order: 720, enabled: hasPixelLayer, run: () => transformLayer("flipH") },
  { id: "edit.transform.flipV", label: "Flip Vertical", menu: "Edit/Transform", order: 721, enabled: hasPixelLayer, run: () => transformLayer("flipV") },

  { id: "edit.defineBrush", label: "Define Brush Preset…", menu: "Edit", order: 800, keywords: ["custom brush", "sampled tip"], enabled: hasDoc, run: defineBrushPreset },
  { id: "edit.definePattern", label: "Define Pattern…", menu: "Edit", order: 801, keywords: ["tile"], enabled: hasDoc, run: definePatternFromSelection },
  { id: "edit.purge.undo", label: "Undo", menu: "Edit/Purge", order: 850, enabled: hasDoc, run: () => purge("undo") },
  { id: "edit.purge.histories", label: "Histories", menu: "Edit/Purge", order: 851, enabled: () => docStore.docs.length > 0, run: () => purge("histories") },
  { id: "edit.purge.all", label: "All", menu: "Edit/Purge", order: 852, enabled: () => docStore.docs.length > 0, run: () => purge("all") },
]);

/**
 * Free Transform is registered (asynchronously) by the filters module at order 300;
 * move it into the Transform group so the menu reads like Photoshop's.
 */
void import("$lib/filters/register")
  .then(() => {
    const c = getCommand("edit.transform");
    if (c && c.order !== 700) registerCommand({ ...c, order: 700 });
  })
  .catch(() => {});
