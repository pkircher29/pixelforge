/**
 * Pure helpers behind the Properties panel: adjustment-layer parameter binding,
 * mask Density / Feather (applied destructively with Apply — the engine has no mask
 * render params), and the per-kind header / context detection.
 */
import { Raster, opById, type AdjustmentLayer, type Document, type Layer, type ParamDef, type ParamValues } from "$lib/engine";
import { defaultParams, type ParamValue } from "$lib/engine/ops/types";

export type PropertiesContext = "none" | "document" | "pixel" | "group" | "adjustment" | "fill" | "shape" | "text" | "mask";

/** Which Properties page to show. */
export function propertiesContext(doc: Document | null, layer: Layer | null, maskTargeted: boolean): PropertiesContext {
  if (!doc) return "none";
  if (!layer) return "document";
  if (maskTargeted && layer.mask) return "mask";
  switch (layer.kind) {
    case "raster":
      return "pixel";
    case "group":
      return "group";
    case "adjustment":
      return "adjustment";
    case "fill":
      return "fill";
    case "shape":
      return "shape";
    case "text":
      return "text";
  }
}

export const CONTEXT_TITLE: Record<PropertiesContext, string> = {
  none: "Properties",
  document: "Document Properties",
  pixel: "Pixel Layer Properties",
  group: "Group Properties",
  adjustment: "Adjustment",
  fill: "Fill Layer Properties",
  shape: "Live Shape Properties",
  text: "Type Layer Properties",
  mask: "Masks",
};

/** Parameter defs of an adjustment layer's op visible for its current group selector. */
export function visibleAdjustmentParams(layer: AdjustmentLayer): { defs: ParamDef[]; group: string | null; selector: NonNullable<ReturnType<typeof opById>>["groupSelector"] | null } {
  const op = opById(layer.op);
  if (!op) return { defs: [], group: null, selector: null };
  const sel = op.groupSelector ?? null;
  const group = sel ? String(layer.params[sel.id] ?? sel.default) : null;
  return { defs: op.params.filter((p) => !p.group || p.group === group), group, selector: sel };
}

/** Default parameter values for the layer's op (Reset to Default). */
export function adjustmentDefaults(layer: AdjustmentLayer): ParamValues {
  const op = opById(layer.op);
  return op ? defaultParams(op) : {};
}

/** Current numeric value of a param (falls back to the def's default). */
export function paramNumber(params: ParamValues, def: ParamDef): number {
  const v = params[def.id];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return def.kind === "number" ? def.default : 0;
}

/** True when any param differs from its default. */
export function adjustmentModified(layer: AdjustmentLayer): boolean {
  const d = adjustmentDefaults(layer);
  return Object.keys(d).some((k) => JSON.stringify(d[k]) !== JSON.stringify(layer.params[k] as ParamValue));
}

/**
 * Mask Density: 100 % = mask as painted, 0 % = mask fully revealing (white).
 * `v' = v + (255 − v) · (1 − density)`.
 */
export function maskWithDensity(mask: Raster, density: number): Raster {
  const d = Math.max(0, Math.min(1, density));
  const out = mask.clone();
  const p = out.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = p[i]! + (255 - p[i]!) * (1 - d);
    p[i] = p[i + 1] = p[i + 2] = v;
    p[i + 3] = 255;
  }
  return out;
}

/** Mask Feather: Gaussian blur of the mask by `radius` px (via the engine blur op). */
export function maskWithFeather(mask: Raster, radius: number): Raster {
  if (radius <= 0) return mask.clone();
  const blur = opById("gaussian-blur");
  if (!blur) return mask.clone();
  return blur.cpu(mask, { radius });
}

/** Density then feather, as PS applies them. */
export function processMask(mask: Raster, density: number, feather: number): Raster {
  return maskWithFeather(maskWithDensity(mask, density), feather);
}

/** Inverted mask (Properties ▸ Invert). */
export function invertMask(mask: Raster): Raster {
  const out = mask.clone();
  const p = out.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = 255 - p[i]!;
    p[i] = v;
    p[i + 1] = v;
    p[i + 2] = v;
    p[i + 3] = 255;
  }
  return out;
}

/** Nudge a layer's W / H by resampling (Properties ▸ Transform). Returns null when nothing changes. */
export function resizedRaster(raster: Raster, w: number, h: number): Raster | null {
  const nw = Math.max(1, Math.round(w));
  const nh = Math.max(1, Math.round(h));
  if (nw === raster.width && nh === raster.height) return null;
  return raster.resize(nw, nh, "bilinear");
}
