/** Generative variants reuse ordinary layer pixels, masks and project PNG storage. */
import { createGroupLayer, findLayer, removeLayer } from "./document";
import type { Command, Document, GenerativeVariants, GroupLayer, LayerId, RasterLayer } from "./types";

export function generativeFromFile(value: unknown): GenerativeVariants | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.prompt !== "string" || typeof v.provider !== "string" || typeof v.model !== "string"
    || !Array.isArray(v.variantIds) || v.variantIds.length < 1 || v.variantIds.length > 10
    || !v.variantIds.every((id) => typeof id === "string") || new Set(v.variantIds).size !== v.variantIds.length) return undefined;
  return { prompt: v.prompt, provider: v.provider, model: v.model, variantIds: v.variantIds.slice() };
}

export function generativeVariants(doc: Document, group: GroupLayer): RasterLayer[] {
  return (group.generative?.variantIds ?? []).flatMap((id) => {
    const l = findLayer(doc, id);
    return l?.kind === "raster" && l.parentId === group.id ? [l] : [];
  });
}

/** One undo step adds the collapsed container and all of its editable variants. */
export class AddGenerativeLayerCommand implements Command {
  readonly label = "Generative Fill";
  readonly group: GroupLayer;
  private previous: LayerId | null = null;
  constructor(doc: Document, private readonly variants: RasterLayer[], info: Omit<GenerativeVariants, "variantIds">) {
    if (variants.length !== 3 || new Set(variants.map((l) => l.id)).size !== 3) throw new Error("Generative Fill needs three distinct variants");
    this.group = createGroupLayer(doc, { name: `Generative Fill: ${info.prompt.slice(0, 40)}`, collapsed: true, passThrough: false });
    this.group.generative = { ...info, variantIds: variants.map((l) => l.id) };
    variants.forEach((l, i) => { l.parentId = this.group.id; l.visible = i === 0; l.name = `Variant ${i + 1}`; });
  }
  do(doc: Document): void {
    this.previous = doc.activeLayerId;
    doc.layers.push(this.group, ...this.variants);
    doc.activeLayerId = this.group.id;
    doc.dirty = true;
  }
  undo(doc: Document): void {
    removeLayer(doc, this.group.id);
    doc.activeLayerId = this.previous;
    doc.dirty = true;
  }
  byteSize(): number { return this.variants.reduce((n, l) => n + l.raster.byteLength() + (l.mask?.byteLength() ?? 0), 0); }
}

/** Visibility switching preserves each variant's pixel edits and is fully undoable. */
export class SelectGenerativeVariantCommand implements Command {
  readonly label = "Switch Generative Variant";
  private previous: [LayerId, boolean][] | null = null;
  constructor(private readonly groupId: LayerId, private readonly variantId: LayerId) {}
  do(doc: Document): void {
    const g = findLayer(doc, this.groupId);
    if (g?.kind !== "group" || !g.generative) throw new Error("Generative layer no longer exists");
    const variants = generativeVariants(doc, g);
    if (!variants.some((v) => v.id === this.variantId)) throw new Error("Variant no longer belongs to this generative layer");
    this.previous ??= variants.map((v) => [v.id, v.visible]);
    variants.forEach((v) => { v.visible = v.id === this.variantId; });
    doc.dirty = true;
  }
  undo(doc: Document): void {
    for (const [id, visible] of this.previous ?? []) {
      const l = findLayer(doc, id);
      if (l) l.visible = visible;
    }
    doc.dirty = true;
  }
  byteSize(): number { return (this.previous?.length ?? 0) * 32; }
}
