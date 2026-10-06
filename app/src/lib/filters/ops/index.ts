/**
 * Registry of every adjustment and filter op, in menu order.
 */

import type { OpDef } from "../types";
import { brightnessContrast } from "./brightnessContrast";
import { levels } from "./levels";
import { hueSaturation } from "./hueSaturation";
import { colorBalance } from "./colorBalance";
import { desaturate, exposure, invert, posterize, threshold } from "./simple";
import { gaussianBlur, motionBlur } from "./blur";
import { sharpen, unsharpMask } from "./sharpen";
import { addNoise } from "./noise";
import { pixelate } from "./pixelate";

/** Adjustments (Image > Adjustments), in menu order. */
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

export function opById(id: string): OpDef | undefined {
  return byId.get(id);
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
