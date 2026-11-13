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
 * history.push(new SetLayerEffectsCommand(layer.id, { dropShadow: defaultDropShadow() }));
 * const adj = createAdjustmentLayer(doc, { op: "hue-saturation", params: { saturation: -50 } });
 * history.push(new AddLayerCommand(adj));
 * const compositor = createCompositor(canvasEl);
 * const viewport = new Viewport().fitToView(w, h, doc.width, doc.height, 40);
 * compositor.render(doc, viewport, { dpr: devicePixelRatio, activeLayerId: doc.activeLayerId });
 * ```
 */

export * from "./types";
export { AddGenerativeLayerCommand, SelectGenerativeVariantCommand, generativeVariants, generativeFromFile } from "./generative";
export { Rect } from "./rect";
export type { Point } from "./rect";
export { Raster, rgba } from "./raster";
export { TiledRaster, RASTER_TILE_SIZE } from "./raster-tiled";
export { Selection } from "./selection";
export {
  BLEND_MODES,
  BLEND_MODES_MENU,
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
  defaultQuickMask,
  defaultLock,
  createDocument,
  createRasterLayer,
  createGroupLayer,
  createAdjustmentLayer,
  createFillLayer,
  createShapeLayer,
  createTextLayer,
  rerasterizeShape,
  rerasterizeText,
  nextLayerName,
  findLayer,
  getLayer,
  getRasterLayer,
  getPixelLayer,
  isPixelLayer,
  layerIndex,
  activeLayer,
  childrenOf,
  topLevelLayers,
  siblingsOf,
  layerDocRect,
  layerBlock,
  clipBaseOf,
  clippedLayersOf,
  addLayer,
  removeLayer,
  cloneLayer,
  layerBaseOf,
  duplicateLayer,
  moveLayer,
  renameLayer,
  setLayerProps,
  compositeLayers,
  rasterizeLayer,
  mergeDown,
  mergeVisible,
  flatten,
  groupLayers,
  ungroupLayers,
  isEffectivelyVisible,
  addAlphaChannel,
  removeAlphaChannel,
  findAlphaChannel,
  findPath,
  blendRasterInto,
  applyAdjustmentInto,
  compositeToRaster,
  compositeSelectionBbox,
  documentByteSize,
  fillLayerPreview,
} from "./document";
export type {
  CreateDocumentOptions,
  CreateLayerOptions,
  CreateGroupOptions,
  CreateAdjustmentOptions,
  CreateFillOptions,
  CreateShapeOptions,
  CreateTextOptions,
  CompositeOptions,
} from "./document";
export { StyleCache, layerSource, layerRaster, layerHasPixels, maskActive, fillLayerRaster, invalidateFillLayer, layerVisualRect, bindDocStyleCache, docStyleCache } from "./layer-source";
export type { LayerSource, StyledSource } from "./layer-source";
export { History, DEFAULT_HISTORY_BUDGET, SnapshotCommand } from "./history";
export type { HistoryOptions, PushOptions } from "./history";
export { captureDocState, restoreDocState, stateLayerRaster } from "./snapshot";
export type { DocState } from "./snapshot";
export { LayerLockedError, isLayerEditable, assertEditable, effectiveLock, applyTransparencyLock } from "./locks";
export type { LayerEditOp } from "./locks";
export {
  channelFromSelection,
  saveSelectionAsChannel,
  loadChannelAsSelection,
  loadMaskAsSelection,
  combineSelections,
  enterQuickMask,
  exitQuickMask,
  quickMaskTarget,
  parseViewChannel,
  channelViewRaster,
  overlayQuickMask,
  overlayChannel,
} from "./channels";
export type { SelectionCombineMode } from "./channels";
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
export * as ops from "./ops";
export * from "./ops";
