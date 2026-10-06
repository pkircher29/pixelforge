/**
 * Registry of every adjustment and filter op, in menu order. Adjustment layers refer
 * to ops by `id` (`AdjustmentLayer.op`) and the compositor runs `op.cpu` (or the GLSL
 * passes on the GPU path) on the composite below the layer.
 *
 * `lib/filters/ops` re-exports this module so the filters UI keeps working unchanged.
 */

import type { OpDef } from "./types";
import { brightnessContrast } from "./brightnessContrast";
import { levels } from "./levels";
import { hueSaturation } from "./hueSaturation";
import { colorBalance } from "./colorBalance";
import { desaturate, exposure, invert, posterize, threshold } from "./simple";
import { gaussianBlur, motionBlur } from "./blur";
import { sharpen, unsharpMask } from "./sharpen";
import { addNoise } from "./noise";
import { pixelate } from "./pixelate";

/** Adjustments (Image > Adjustments), in menu order. These are also the adjustment-layer ops. */
export const ADJUSTMENT_OPS: readonly OpDef[] = [
  brightnessContrast,
  levels,
  // Curves is v1.1 (the `curve` param type is reserved in types.ts).
  exposure,
  hueSaturation,
  colorBalance,
  invert,
  desaturate,
  threshold,
  posterize,
];

/** Filters (Filter menu), in menu order. */
export const FILTER_OPS: readonly OpDef[] = [gaussianBlur, motionBlur, sharpen, unsharpMask, addNoise, pixelate];

export const ALL_OPS: readonly OpDef[] = [...ADJUSTMENT_OPS, ...FILTER_OPS];

const byId = new Map(ALL_OPS.map((op) => [op.id, op]));

/** Look an op up by its stable id (`"levels"`, `"gaussian-blur"`, ...). */
export function opById(id: string): OpDef | undefined {
  return byId.get(id);
}

/**
 * Register an extra op (plugins / tests). Replaces any op with the same id. Ops added
 * here are visible to `opById` and therefore usable by adjustment layers.
 */
export function registerOp(op: OpDef): void {
  byId.set(op.id, op);
}

/** Command id an op is registered under (`image.adjust.<id>` / `filter.<id>`). */
export function commandIdFor(op: OpDef): string {
  return op.menu === "Image/Adjustments" ? `image.adjust.${op.id}` : `filter.${op.id}`;
}

export {
  brightnessContrast,
  levels,
  exposure,
  hueSaturation,
  colorBalance,
  invert,
  desaturate,
  threshold,
  posterize,
  gaussianBlur,
  motionBlur,
  sharpen,
  unsharpMask,
  addNoise,
  pixelate,
};
