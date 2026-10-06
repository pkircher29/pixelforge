/**
 * Compositor entry point: `createCompositor(canvas)` picks WebGL2 and falls back to
 * Canvas 2D.
 */

import type { ICompositor } from "../types";
import { CanvasCompositor } from "./CanvasCompositor";
import { GlCompositor, type GlCompositorOptions, type CompositorColors, DEFAULT_COMPOSITOR_COLORS } from "./GlCompositor";

export { GlCompositor, CanvasCompositor, DEFAULT_COMPOSITOR_COLORS };
export type { GlCompositorOptions, CompositorColors };
export { DirtyTracker, lowestIndexOf } from "./dirty";
export { computeSelectionEdge, thresholdMask } from "./ants";
export {
  FULLSCREEN_VERT,
  PRESENT_FRAG,
  buildBlendFragment,
  buildBlendSwitch,
  buildBlendSingle,
  BLEND_UNIFORMS,
  PRESENT_UNIFORMS,
} from "./shaders";

export interface CreateCompositorOptions extends GlCompositorOptions {
  /** Force the Canvas 2D path (debugging). */
  forceCanvas2d?: boolean;
}

/**
 * Create the best available compositor for `canvas`. Throws only if neither WebGL2 nor
 * Canvas 2D can be obtained.
 */
export function createCompositor(canvas: HTMLCanvasElement, opts: CreateCompositorOptions = {}): ICompositor {
  if (!opts.forceCanvas2d) {
    try {
      return new GlCompositor(canvas, opts);
    } catch (e) {
      console.warn("[pixelforge] WebGL2 compositor unavailable, falling back to Canvas 2D:", e);
    }
  }
  return new CanvasCompositor(canvas, opts.colors ? { colors: opts.colors } : {});
}
