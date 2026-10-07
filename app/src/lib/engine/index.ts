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
export {
  // Effects
  effectExtent,
  hasEnabledEffects,
  cloneEffects,
  renderLayerStyle,
  applyMaskToRaster,
  defaultDropShadow,
  defaultInnerShadow,
  defaultOuterGlow,
  defaultInnerGlow,
  defaultBevelEmboss,
  defaultColorOverlay,
  defaultGradientOverlay,
  defaultStroke,
  DEFAULT_GLOBAL_LIGHT_ANGLE,
  DEFAULT_GLOBAL_LIGHT_ALTITUDE,
  // Fills
  renderFill,
  renderGradient,
  renderPattern,
  gradientColorAt,
  gradientLut,
  gradientParam,
  solidFill,
  gradientFill,
  patternFill,
  cloneFill,
  // Vector
  newPath,
  newPathId,
  anchor,
  clonePath,
  translatePath,
  rectPath,
  roundedRectPath,
  ellipsePath,
  polygonPath,
  regularPolygonPath,
  bezierPoint,
  flattenSubpath,
  flattenPath,
  pathBounds,
  polygonsCoverage,
  pathCoverage,
  pathToSelection,
  coverageToRaster,
  coverageBounds,
  fillPathToRaster,
  strokeOutline,
  strokePathCoverage,
  strokePathToRaster,
  simplifyPolyline,
  simplifyRing,
  traceMaskOutlines,
  selectionToPath,
  smoothAnchors,
  nearestAnchor,
  nearestSegment,
  splitSegmentAt,
  removeAnchor,
  // Text
  textSpec,
  rasterizeText,
  textBounds,
  textLines,
  lineHeightOf,
  cssFont,
  // Matting
  defringe,
  removeMatte,
  // Distance / morphology
  distanceTransformSquared,
  dilateCoverage,
  erodeCoverage,
  blurCoverage,
  // Registry
  ADJUSTMENT_OPS,
  FILTER_OPS,
  ALL_OPS,
  opById,
  registerOp,
} from "./ops";
export type { StyledRaster, CoverageOptions, StrokeOptions, AnchorHit, SegmentHit, OpDef, ParamValues, ParamDef, GlslPass } from "./ops";
