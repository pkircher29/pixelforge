/**
 * Registry of every adjustment and filter op, in menu order.
 *
 * The implementations moved to `$lib/engine/ops` (Wave 5, PLAN-v2 §1) so the engine's
 * adjustment layers can run them without depending on the filters UI. This module is a
 * thin re-export kept for the filters UI, tests and the command registry.
 */

export {
  ADJUSTMENT_OPS,
  FILTER_OPS,
  ALL_OPS,
  opById,
  registerOp,
  commandIdFor,
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
} from "$lib/engine/ops/registry";
