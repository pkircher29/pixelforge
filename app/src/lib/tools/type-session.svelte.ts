/**
 * Type editing session: one live edit of a text layer (or a type-mask preview).
 * The layer is mutated directly while editing (no history noise); `commit` restores the
 * original and pushes a single `SetTextLayerCommand`; `cancel` restores (and removes a
 * freshly created layer). The Character / Paragraph panels edit `spec` through `update`.
 */
import {
  AddLayerCommand,
  RemoveLayerCommand,
  Selection,
  SetSelectionCommand,
  SetTextLayerCommand,
  typeLayerName,
  createTextLayer,
  findLayer,
  newId,
  rasterizeText,
  rerasterizeText,
  textSpec,
  type TextSpec,
} from "$lib/engine";
import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { emptyModel, fromTextarea, type TextModel } from "./text-session";

export type TypeVariant = "h" | "v" | "mask-h" | "mask-v";

class TypeSession {
  active = $state(false);
  layerId = $state<string | null>(null);
  variant = $state<TypeVariant>("h");
  spec = $state<TextSpec>(textSpec("", 0, 0));
  model = $state<TextModel>(emptyModel());
  /** Bumped on every change so overlays redraw. */
  version = $state(0);
  isNew = false;
  private entry: OpenDoc | null = null;
  private original: { text: TextSpec; raster: import("$lib/engine").Raster } | null = null;
  private returnActiveLayer: string | null = null;

  get isMask(): boolean {
    return this.variant.startsWith("mask");
  }

  /** Start editing an existing text layer. */
  beginEdit(layerId: string): boolean {
    const entry = docStore.active;
    if (!entry) return false;
    const l = findLayer(entry.doc, layerId);
    if (!l || l.kind !== "text") return false;
    if (this.active) this.commit();
    this.entry = entry;
    this.layerId = layerId;
    this.isNew = false;
    this.variant = l.text.vertical ? "v" : "h";
    this.original = { text: l.text, raster: l.raster };
    this.spec = { ...l.text };
    this.model = emptyModel(l.text.text);
    this.returnActiveLayer = entry.doc.activeLayerId;
    entry.doc.activeLayerId = layerId;
    this.activate(l.text.x, l.text.y);
    return true;
  }

  /** Start a new text layer (or mask preview) at a document point. */
  beginNew(x: number, y: number, spec: TextSpec, variant: TypeVariant): boolean {
    const entry = docStore.active;
    if (!entry) return false;
    if (this.active) this.commit();
    this.entry = entry;
    this.variant = variant;
    this.spec = { ...spec, x, y, text: "", vertical: variant === "v" || variant === "mask-v" };
    this.model = emptyModel("");
    this.returnActiveLayer = entry.doc.activeLayerId;
    if (this.isMask) {
      this.layerId = null;
      this.isNew = false;
      this.original = null;
    } else {
      const layer = createTextLayer(entry.doc, { id: newId("text"), text: { ...this.spec }, name: "Type" });
      const doc = entry.doc;
      const active = doc.activeLayerId ? doc.layers.findIndex((l) => l.id === doc.activeLayerId) : -1;
      docStore.exec(new AddLayerCommand(layer, active >= 0 ? active + 1 : undefined, "Type Tool"), { noMerge: true });
      doc.activeLayerId = layer.id;
      this.layerId = layer.id;
      this.isNew = true;
      this.original = { text: layer.text, raster: layer.raster };
    }
    this.activate(x, y);
    return true;
  }

  private activate(x: number, y: number): void {
    this.active = true;
    ui.textEdit = { docX: x, docY: y, value: this.model.text };
    this.version++;
    docStore.touch();
  }

  /** Sync text + selection from the hidden textarea. */
  syncFromTextarea(text: string, start: number, end: number, direction: "forward" | "backward" | "none"): void {
    const m = fromTextarea(text, start, end, direction);
    const changed = m.text !== this.model.text;
    this.model = m;
    if (changed) this.applySpec({ text });
    else this.version++;
  }

  setModel(m: TextModel): void {
    const changed = m.text !== this.model.text;
    this.model = m;
    if (changed) this.applySpec({ text: m.text });
    else this.version++;
  }

  /** Patch the live spec (Character / Paragraph panels, options bar). */
  update(patch: Partial<TextSpec>): void {
    if (!this.active) return;
    this.applySpec(patch);
  }

  private applySpec(patch: Partial<TextSpec>): void {
    this.spec = { ...this.spec, ...patch };
    this.version++;
    const entry = this.entry;
    if (!entry) return;
    if (this.layerId) {
      const l = findLayer(entry.doc, this.layerId);
      if (l && l.kind === "text") {
        l.text = { ...this.spec };
        rerasterizeText(entry.doc, l);
        docStore.touch({ layerId: l.id });
        return;
      }
    }
    docStore.touch();
  }

  /** Commit the edit as one history step. Returns true when something was committed. */
  commit(): boolean {
    if (!this.active) return false;
    const entry = this.entry;
    const spec = { ...this.spec };
    const layerId = this.layerId;
    const isNew = this.isNew;
    const mask = this.isMask;
    const original = this.original;
    this.finish();
    if (!entry) return false;
    if (mask) {
      if (!spec.text.trim()) return false;
      const r = rasterizeText(spec, entry.doc.width, entry.doc.height);
      const sel = Selection.fromLayerAlpha(r);
      docStore.exec(new SetSelectionCommand(sel, "Type Mask"), { noMerge: true });
      return true;
    }
    if (!layerId) return false;
    const l = findLayer(entry.doc, layerId);
    if (!l || l.kind !== "text") return false;
    if (!spec.text.trim()) {
      // Empty text: a new layer is dropped, an existing one keeps its old text.
      if (isNew) this.dropNewLayer(entry, layerId);
      else if (original) {
        l.text = original.text;
        l.raster = original.raster;
        docStore.touch({ layerId });
      }
      return false;
    }
    if (original) {
      l.text = original.text;
      l.raster = original.raster;
    }
    if (isNew) l.name = typeLayerName(spec.text) || "Type";
    docStore.exec(new SetTextLayerCommand(layerId, spec, isNew ? "Type Tool" : "Edit Type"), { noMerge: true });
    return true;
  }

  cancel(): void {
    if (!this.active) return;
    const entry = this.entry;
    const layerId = this.layerId;
    const isNew = this.isNew;
    const original = this.original;
    const ret = this.returnActiveLayer;
    this.finish();
    if (!entry) return;
    if (layerId) {
      if (isNew) this.dropNewLayer(entry, layerId);
      else {
        const l = findLayer(entry.doc, layerId);
        if (l && l.kind === "text" && original) {
          l.text = original.text;
          l.raster = original.raster;
          docStore.touch({ layerId });
        }
      }
    }
    if (ret && findLayer(entry.doc, ret)) entry.doc.activeLayerId = ret;
    docStore.touch();
  }

  private dropNewLayer(entry: OpenDoc, layerId: string): void {
    if (entry.history.undoLabel === "Type Tool") entry.history.undo();
    else if (findLayer(entry.doc, layerId)) docStore.exec(new RemoveLayerCommand(layerId), { noMerge: true });
  }

  private finish(): void {
    this.active = false;
    this.entry = null;
    this.layerId = null;
    this.original = null;
    this.isNew = false;
    this.returnActiveLayer = null;
    ui.textEdit = null;
    this.version++;
  }
}

export const typeSession = new TypeSession();

/** Default spec for new text from the Type tool options + foreground color. */
export function specFromOptions(toolId: string, vertical: boolean): TextSpec {
  const o = <T extends string | number | boolean>(k: string, d: T): T => toolStore.option(toolId, k, d);
  const style = o<string>("style", "regular");
  const aa = o<string>("antialias", "smooth");
  return textSpec("", 0, 0, {
    font: o<string>("family", "Segoe UI"),
    size: o<number>("size", 48),
    bold: style === "bold" || style === "boldItalic",
    italic: style === "italic" || style === "boldItalic",
    align: o<string>("align", "left") as TextSpec["align"],
    antialias: aa !== "none",
    color: { ...toolStore.fg },
    vertical,
    leading: null,
    tracking: 0,
  });
}
