/**
 * Filter / adjustment contract.
 *
 * An `OpDef` describes one image operation twice: as GLSL ES 3.00 fragment passes for the
 * standalone WebGL2 runner (`gpu.ts`) and as a pure TypeScript function (`cpu`). Both must
 * produce the same pixels (within rounding) so the UI can transparently fall back.
 *
 * Colour-math assumptions (v1): channels are treated as linear 0..1 values even though the
 * stored bytes are sRGB-encoded. This matches Photoshop 7's 8-bit behaviour and keeps the
 * GPU and CPU paths trivially identical. Blurs and resampling operate on **premultiplied**
 * RGB to avoid dark fringes at alpha edges, then un-premultiply before storing.
 */

import type { Raster } from "../raster";

export type OpMenu =
  | "Image/Adjustments"
  | "Filter/Blur"
  | "Filter/Sharpen"
  | "Filter/Noise"
  | "Filter/Pixelate";

export interface NumberParam {
  kind: "number";
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Suffix shown after the numeric field, e.g. "%", "px", "°". */
  unit?: string;
  /** Only shown when the op's `groupSelector` has this value. */
  group?: string;
}

export interface BooleanParam {
  kind: "boolean";
  id: string;
  label: string;
  default: boolean;
  group?: string;
}

export interface SelectParam {
  kind: "select";
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  group?: string;
}

/**
 * A tone curve: flat list of `[x0, y0, x1, y1, ...]` control points in 0..1. Reserved for
 * Curves (v1.1); the dialog renders it as read-only JSON for now.
 */
export interface CurveParam {
  kind: "curve";
  id: string;
  label: string;
  default: number[];
  group?: string;
}

export type ParamDef = NumberParam | BooleanParam | SelectParam | CurveParam;

export type ParamValue = number | boolean | string | number[];
export type ParamValues = Record<string, ParamValue>;

/** A uniform value accepted by `GpuOp`. Arrays of length 2/3/4 map to vec2/3/4. */
export type UniformValue = number | boolean | number[] | Float32Array | Int32Array;

/**
 * One fragment pass. `source` must define `vec4 pf_op(ivec2 p)` and may use the runtime
 * preamble (`u_image` = previous pass or the input, `u_source` = the original input,
 * `u_size` = size of `u_image`, `pf_fetch(ivec2)` = clamped texel fetch of `u_image`,
 * `pf_fetchSource(ivec2)` = clamped texel fetch of `u_source`).
 */
export interface GlslPass {
  source: string;
  uniforms?: Record<string, UniformValue>;
  /**
   * Output size of this pass as a fraction of the input size (downsample tricks for big
   * blurs). The last pass is always rendered at the input size. Default 1.
   */
  scale?: number;
}

export interface OpDef {
  /** Stable id, e.g. "levels", "gaussian-blur". */
  id: string;
  label: string;
  menu: OpMenu;
  params: ParamDef[];
  /** Electron-style accelerator registered by `register.ts`. */
  shortcut?: string;
  /** Extra palette keywords. */
  keywords?: string[];
  /** Run immediately without a dialog (Invert, Desaturate). */
  instant?: boolean;
  /** Show the live histogram in the dialog. */
  histogram?: boolean;
  /** A select that filters which `group` of params is visible (Levels channel, Color Balance range). */
  groupSelector?: { id: string; label: string; options: { value: string; label: string }[]; default: string };
  /** GLSL passes for the given params. */
  glsl(params: ParamValues): GlslPass[];
  /** Pure-TS implementation; returns a new raster of the same size. */
  cpu(src: Raster, params: ParamValues): Raster;
  /** Pixels of context needed around the dirty rect (blur radius). Default 0. */
  margin?(params: ParamValues): number;
  /** Compute parameter values from a histogram (Levels "Auto"); merged over the current values. */
  auto?(hist: Histogram): ParamValues;
}

/** 256-bin histogram of a raster region. */
export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Luma (Rec.709). */
  l: Uint32Array;
  /** Number of pixels counted (alpha > 0). */
  count: number;
}

/** Default values of every param of an op. */
export function defaultParams(op: OpDef): ParamValues {
  const out: ParamValues = {};
  for (const p of op.params) out[p.id] = Array.isArray(p.default) ? p.default.slice() : p.default;
  if (op.groupSelector) out[op.groupSelector.id] = op.groupSelector.default;
  return out;
}

export function num(params: ParamValues, id: string, fallback = 0): number {
  const v = params[id];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function bool(params: ParamValues, id: string, fallback = false): boolean {
  const v = params[id];
  return typeof v === "boolean" ? v : fallback;
}

export function str(params: ParamValues, id: string, fallback = ""): string {
  const v = params[id];
  return typeof v === "string" ? v : fallback;
}
