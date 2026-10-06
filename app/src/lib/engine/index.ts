/**
 * Pixelforge document engine — public barrel.
 *
 * Pure TypeScript, no Svelte. See `types.ts` for the contract and conventions.
 *
 * Quick tour:
 * ```ts
 * const doc = createDocument({ width: 1024, height: 768, background: "white" });
 * const history = new History(doc, { onApply: (cmd) => cmd.affected?.().forEach(d => compositor.markDirty(d.layerId, d.rect)) });
 * const layer = createRasterLayer(doc, { name: "Paint" });
 * history.push(new AddLayerCommand(layer));
 * const compositor = createCompositor(canvasEl);
 * const viewport = new Viewport().fitToView(w, h, doc.width, doc.height, 40);
 * compositor.render(doc, viewport, { dpr: devicePixelRatio, activeLayerId: doc.activeLayerId });
 * ```
 */

export * from "./types";
export { Rect } from "./rect";
export type { Point } from "./rect";
export { Raster, rgba } from "./raster";
export { Selection } from "./selection";
export {
  BLEND_MODES,
  BLEND_MODE_INDEX,
  BLEND_MODE_LABEL,
  BLEND_GLSL,
  BLEND_GLSL_HELPERS,
  isSeparable,
  isBlendMode,
  blendChannel,
  blendRgb,
  compositeStraight,
} from "./blend";
export {
  MAX_CANVAS_SIZE,
  newId,
  createDocument,
  createRasterLayer,
  createGroupLayer,
  nextLayerName,
  findLayer,
  getLayer,
  getRasterLayer,
  layerIndex,
  activeLayer,
  childrenOf,
  topLevelLayers,
  layerDocRect,
  layerBlock,
  addLayer,
  removeLayer,
  duplicateLayer,
  moveLayer,
  renameLayer,
  setLayerProps,
  compositeLayers,
  mergeDown,
  mergeVisible,
  flatten,
  groupLayers,
  ungroupLayers,
  isEffectivelyVisible,
  compositeToRaster,
  compositeSelectionBbox,
  documentByteSize,
} from "./document";
export type { CreateDocumentOptions, CreateLayerOptions, CompositeOptions } from "./document";
export { History, DEFAULT_HISTORY_BUDGET } from "./history";
export type { HistoryOptions, PushOptions } from "./history";
export * from "./commands";
export {
  Viewport,
  ZOOM_STEPS,
  MIN_ZOOM,
  MAX_ZOOM,
  nextZoomStep,
  prevZoomStep,
  clampZoom,
  formatZoom,
} from "./viewport";
export * from "./composite";
