/**
 * Public contract of the Pixelforge document engine (v2 — PLAN-v2 §1 "Layer system").
 *
 * Everything the UI shell, tools, AI panel and filters program against lives here (or is
 * re-exported from here). Concrete classes (`Raster`, `Selection`, `History`, `Viewport`,
 * the compositors) live in their own modules and are re-exported by `index.ts`.
 *
 * Conventions used throughout the engine:
 * - Pixels are RGBA8 with **straight (non-premultiplied) alpha** in storage.
 * - `layers[0]` is the **bottom** layer; higher indices are drawn on top.
 * - A group's children are the contiguous run of layers with `parentId === group.id`
 *   located **immediately after** the group entry (higher indices), bottom to top.
 *   Only one nesting level is supported.
 * - A layer with `clipToBelow` is clipped by the nearest layer below it (same parent)
 *   that is *not* itself clipped: the "base". The base plus its chain of clipped layers
 *   is composited as one unit and then blended with the base's blend mode and opacity
 *   (Photoshop "Blend Clipped Layers as Group").
 * - All document coordinates are integer pixel units with the origin at the top-left.
 * - Screen coordinates passed to `Viewport` are CSS pixels; the compositor applies DPR.
 *
 * This file is the contract for Wave 6 (`layers-v2`, `tools-v2`, `panels-v2`): extend,
 * do not rename or remove.
 */

import type { Rect, Point } from "./rect";
import type { Raster } from "./raster";
import type { Selection } from "./selection";
import type { Viewport } from "./viewport";
import type { ParamValues } from "./ops/types";

export type { Rect, Point };

/** Width/height pair. */
export interface Size {
  w: number;
  h: number;
}

/** A color with 0..255 integer channels and straight alpha. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Resampling filter for {@link IRaster.resize}. */
export type ResampleMethod = "nearest" | "bilinear" | "bicubic";

/**
 * Minimal pixel-buffer contract. `Raster` is the v1 full-canvas implementation; a tiled
 * implementation can replace it in v2 without touching tools (PLAN.md decision).
 */
export interface IRaster {
  readonly width: number;
  readonly height: number;
  /** RGBA8, straight alpha, row-major, `width * height * 4` bytes. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** `{ 0, 0, width, height }`. */
  bounds(): Rect;
  /** Deep copy. */
  clone(): IRaster;
  /** Fill the whole raster (or `rect`) with one color. */
  fill(rgba: RGBA, rect?: Rect): void;
  /** Read a pixel; out-of-range reads return transparent black. */
  getPixel(x: number, y: number, out?: RGBA): RGBA;
  /** Write a pixel; out-of-range writes are ignored. */
  setPixel(x: number, y: number, rgba: RGBA): void;
  /** Composite `src` onto this raster at `dx, dy` with straight-alpha "over". */
  blit(src: IRaster, dx: number, dy: number, srcRect?: Rect, opts?: BlitOptions): void;
  /** Copy of the given rect (clamped to bounds; outside pixels are transparent). */
  crop(rect: Rect): IRaster;
  /** Resampled copy. */
  resize(w: number, h: number, method?: ResampleMethod): IRaster;
  flipH(): IRaster;
  flipV(): IRaster;
  /** Rotate by 90 degrees; `cw = true` is clockwise. Returns an `h x w` raster. */
  rotate90(cw: boolean): IRaster;
  /** Smallest rect containing every pixel with `alpha > threshold`, or `null` if none. */
  boundingBoxOfAlpha(threshold?: number): Rect | null;
  /** Canvas-2D `ImageData` view (shares the buffer where the platform allows it). */
  toImageData(): ImageData;
  /** Approximate heap bytes held by the pixel buffer. */
  byteLength(): number;
}

/** Options for {@link IRaster.blit}. */
export interface BlitOptions {
  /** `"over"` (default) composites with straight-alpha over; `"replace"` copies bytes. */
  mode?: "over" | "replace";
  /** Extra opacity multiplier 0..1 for `"over"`. */
  opacity?: number;
}

/**
 * The 16 blend modes of PLAN.md section 2.1. Values are the stable string ids used in
 * `.pfproj` manifests and the GLSL mode switch (`BLEND_MODE_INDEX`).
 */
export enum BlendMode {
  Normal = "normal",
  Multiply = "multiply",
  Screen = "screen",
  Overlay = "overlay",
  Darken = "darken",
  Lighten = "lighten",
  ColorDodge = "color-dodge",
  ColorBurn = "color-burn",
  HardLight = "hard-light",
  SoftLight = "soft-light",
  Difference = "difference",
  Exclusion = "exclusion",
  Hue = "hue",
  Saturation = "saturation",
  Color = "color",
  Luminosity = "luminosity",
}

export type LayerId = string;

/**
 * Layer kinds (PLAN-v2 §1):
 * - `raster` pixel layer
 * - `group` folder (pass-through by default)
 * - `adjustment` non-destructive op applied to everything below (or to its clip base)
 * - `fill` solid / gradient / pattern covering the canvas
 * - `shape` vector path with fill + stroke, rasterized on edit (cached raster)
 * - `text` editable type layer, rasterized on edit (cached raster)
 */
export type LayerKind = "raster" | "group" | "adjustment" | "fill" | "shape" | "text";

/** Photoshop's four lock toggles. `all` implies the other three. */
export interface LayerLock {
  /** Paint ops keep the existing alpha (pixels multiply by the original alpha). */
  transparent: boolean;
  /** Painting / filters / pixel replacement refuse (`LayerLockedError`). */
  pixels: boolean;
  /** Move / transform refuse. */
  position: boolean;
  /** Everything refuses. */
  all: boolean;
}

/** Row tint in the Layers panel (PS "Layer Properties > Color"). */
export type LayerColor = "red" | "orange" | "yellow" | "green" | "blue" | "violet" | "gray";

/** Fields shared by every layer. */
export interface LayerBase {
  readonly id: LayerId;
  name: string;
  readonly kind: LayerKind;
  /** Position of the layer's raster origin in document space. */
  offset: Point;
  /** 0..1 — master opacity: affects pixels *and* effects. */
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  /**
   * Legacy single lock flag (v1 UI). Treated as `lock.all` by `isLayerEditable`;
   * `SetLayerLockCommand` keeps it in sync with `lock.all`.
   */
  locked: boolean;
  /** Id of the enclosing group, or `null` at top level. */
  parentId: LayerId | null;
  /**
   * Layer mask. Grayscale stored in the **red** channel (255 = reveal, 0 = hide). For
   * raster/shape/text layers it is the size of the layer's raster (same origin); for
   * adjustment/fill layers it is document-sized. `null` = no mask.
   */
  mask: Raster | null;
  /** False = mask temporarily disabled (Shift-click, red X). The mask is kept. */
  maskEnabled: boolean;
  /** Chain icon: the Move tool moves layer and mask together. */
  maskLinked: boolean;
  /** Clipping mask: this layer is clipped by the base below it (Alt-click between rows). */
  clipToBelow: boolean;
  /** 0..1 — "Fill": affects the layer's own pixels but not its effects. */
  fillOpacity: number;
  lock: LayerLock;
  /** Layer styles, or `null` when none. */
  effects: LayerEffects | null;
  /** Linked layers move together (symmetric; both sides list each other). */
  linkedTo: LayerId[];
  /** Layers-panel row tint. */
  color: LayerColor | null;
}

/** A pixel layer. */
export interface RasterLayer extends LayerBase {
  readonly kind: "raster";
  raster: Raster;
}

/**
 * A folder of layers. `passThrough` (default true, PS "Pass Through") composites the
 * children straight onto the stack below so blend modes of children see the backdrop;
 * false composites the children in isolation first and then blends the result with the
 * group's own blend mode.
 */
export interface GroupLayer extends LayerBase {
  readonly kind: "group";
  raster: null;
  collapsed: boolean;
  passThrough: boolean;
}

/**
 * Non-destructive adjustment: `op` is an id from the engine op registry
 * (`ops/registry.ts`, e.g. `"levels"`, `"hue-saturation"`); `params` are its parameter
 * values. Affects everything below it in its container (or only the clip base when
 * `clipToBelow`). `mask` (document-sized) limits where it applies.
 */
export interface AdjustmentLayer extends LayerBase {
  readonly kind: "adjustment";
  raster: null;
  op: string;
  params: ParamValues;
}

/** Solid-colour fill. */
export interface SolidFill {
  type: "solid";
  color: RGBA;
}

/** One color stop; `pos` 0..1. */
export interface GradientStop {
  pos: number;
  color: RGBA;
}

/** A gradient definition (opacity lives in the stops' alpha). */
export interface Gradient {
  stops: GradientStop[];
}

export type GradientStyle = "linear" | "radial" | "angle" | "reflected" | "diamond";

/**
 * Gradient fill evaluated over a rect (the layer's content bounds for overlays, the
 * canvas for fill layers). `angle` in degrees, PS convention (0 = left→right, 90 =
 * bottom→top). `scale` 0.1..10 stretches the ramp around the centre; `offset` moves the
 * centre as a fraction of the rect.
 */
export interface GradientFill {
  type: "gradient";
  gradient: Gradient;
  style: GradientStyle;
  angle: number;
  scale: number;
  reverse: boolean;
  offset: Point;
}

/** Tiled raster pattern. `scale` multiplies the tile size; `offset` shifts the tiling (px). */
export interface PatternFill {
  type: "pattern";
  pattern: Raster;
  scale: number;
  offset: Point;
}

export type FillSpec = SolidFill | GradientFill | PatternFill;

/** Fill layer: covers the whole canvas (masked / clipped like any layer). */
export interface FillLayer extends LayerBase {
  readonly kind: "fill";
  raster: null;
  fill: FillSpec;
}

// ---------------------------------------------------------------------------
// Paths (bezier) — PLAN-v2 §1 "Paths"
// ---------------------------------------------------------------------------

/** One bezier anchor with its incoming and outgoing handles (absolute coordinates). */
export interface Anchor {
  x: number;
  y: number;
  /** Incoming handle (from the previous anchor). Equal to `x,y` for a straight segment end. */
  inX: number;
  inY: number;
  /** Outgoing handle (towards the next anchor). */
  outX: number;
  outY: number;
  /** `smooth` keeps the handles collinear when one is dragged; `corner` lets them break. */
  type: "corner" | "smooth";
}

export interface Subpath {
  closed: boolean;
  anchors: Anchor[];
}

export interface Path {
  id: string;
  name: string;
  subpaths: Subpath[];
}

export type FillRule = "nonzero" | "evenodd";
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "miter" | "round" | "bevel";

/** Stroke of a shape layer (PS "Stroke" in the shape options bar). */
export interface StrokeSpec {
  width: number;
  fill: SolidFill | GradientFill;
  /** Where the stroke sits relative to the path edge. */
  position: "inside" | "outside" | "center";
  cap: LineCap;
  join: LineJoin;
  /** Dash pattern in px (`[on, off, ...]`), or `null` for solid. */
  dash: number[] | null;
}

/** Vector shape layer: rasterized into the document-sized `raster` cache on every edit. */
export interface ShapeLayer extends LayerBase {
  readonly kind: "shape";
  /** Cached rasterization (document-sized, origin 0,0 plus `offset`). Rebuild with `rerasterizeShape`. */
  raster: Raster;
  path: Path;
  fill: SolidFill | GradientFill | null;
  stroke: StrokeSpec | null;
  fillRule: FillRule;
}

/** Editable type. `x, y` is the baseline origin of the first line (document px). */
export interface TextSpec {
  text: string;
  x: number;
  y: number;
  /** CSS font family, e.g. `"Segoe UI"`. */
  font: string;
  /** Font size in px. */
  size: number;
  color: RGBA;
  align: "left" | "center" | "right";
  /** Line height in px; `null` = auto (1.2 × size). */
  leading: number | null;
  /** Extra inter-character spacing in 1/1000 em (PS tracking). */
  tracking: number;
  bold: boolean;
  italic: boolean;
  /** Vertical type: one glyph per line, stacked downwards from `x, y`. */
  vertical: boolean;
  antialias: boolean;
}

/** Type layer: rasterized into the document-sized `raster` cache with `rerasterizeText`. */
export interface TextLayer extends LayerBase {
  readonly kind: "text";
  raster: Raster;
  text: TextSpec;
}

export type Layer = RasterLayer | GroupLayer | AdjustmentLayer | FillLayer | ShapeLayer | TextLayer;

/** Layers that carry a pixel buffer (`raster` is a `Raster`). */
export type PixelLayer = RasterLayer | ShapeLayer | TextLayer;

// ---------------------------------------------------------------------------
// Layer styles (effects) — PLAN-v2 §1
// ---------------------------------------------------------------------------

/** Common to every effect. `opacity` 0..1. */
export interface EffectBase {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
}

/**
 * Drop Shadow. `angle` is the *light* angle in degrees (PS): the shadow is offset in
 * the opposite direction, so the default 120° casts down-right. `spread` 0..100 (% of
 * `size` applied as a hard expand before the blur), `size` = blur radius px.
 */
export interface DropShadowEffect extends EffectBase {
  color: RGBA;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  spread: number;
  size: number;
  /** PS "Layer Knocks Out Drop Shadow" (default true). */
  knockout: boolean;
}

/** Inner Shadow: shadow of the inverse shape, offset like a drop shadow, clipped to the shape. */
export interface InnerShadowEffect extends EffectBase {
  color: RGBA;
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  /** 0..100 */
  choke: number;
  size: number;
}

/** Outer Glow: blurred, expanded alpha outside the shape (default blend Screen). */
export interface OuterGlowEffect extends EffectBase {
  color: RGBA;
  /** 0..100 */
  spread: number;
  size: number;
}

/** Inner Glow: inside the shape, from the edge or from the centre. */
export interface InnerGlowEffect extends EffectBase {
  color: RGBA;
  /** 0..100 */
  choke: number;
  size: number;
  source: "center" | "edge";
}

/**
 * Bevel & Emboss (simplified: distance-field height map + directional lighting).
 * `depth` 1..1000 (%), `size` px, `soften` px, `angle`/`altitude` degrees.
 */
export interface BevelEmbossEffect extends EffectBase {
  style: "outerBevel" | "innerBevel" | "emboss" | "pillowEmboss";
  technique: "smooth" | "chiselHard" | "chiselSoft";
  depth: number;
  direction: "up" | "down";
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  highlightMode: BlendMode;
  highlightColor: RGBA;
  highlightOpacity: number;
  shadowMode: BlendMode;
  shadowColor: RGBA;
  shadowOpacity: number;
}

export interface ColorOverlayEffect extends EffectBase {
  color: RGBA;
}

export interface GradientOverlayEffect extends EffectBase {
  gradient: Gradient;
  style: GradientStyle;
  angle: number;
  scale: number;
  reverse: boolean;
  /** Evaluate the gradient over the layer's content bounds (true) or the whole canvas. */
  alignWithLayer: boolean;
}

export interface StrokeEffect extends EffectBase {
  size: number;
  position: "inside" | "outside" | "center";
  fillType: "color" | "gradient";
  color: RGBA;
  gradient: Gradient | null;
  gradientStyle: GradientStyle;
  gradientAngle: number;
}

/**
 * Photoshop Layer Style subset. Missing / `enabled: false` effects are skipped. Render
 * order (PS): drop shadow → outer glow → fill (at `fillOpacity`) → inner shadow → inner
 * glow → bevel & emboss → color overlay → gradient overlay → stroke.
 */
export interface LayerEffects {
  dropShadow?: DropShadowEffect;
  innerShadow?: InnerShadowEffect;
  outerGlow?: OuterGlowEffect;
  innerGlow?: InnerGlowEffect;
  bevelEmboss?: BevelEmbossEffect;
  colorOverlay?: ColorOverlayEffect;
  gradientOverlay?: GradientOverlayEffect;
  stroke?: StrokeEffect;
  /** Global light shared by effects with `useGlobalLight` (PS default 120° / 30°). */
  globalLightAngle?: number;
  globalLightAltitude?: number;
}

/** Mutable, user-editable layer properties (for `SetLayerProps`). */
export interface LayerProps {
  name: string;
  offset: Point;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
  passThrough: boolean;
  fillOpacity: number;
  maskEnabled: boolean;
  maskLinked: boolean;
  clipToBelow: boolean;
  color: LayerColor | null;
}

// ---------------------------------------------------------------------------
// Channels, quick mask
// ---------------------------------------------------------------------------

/** A saved selection (Channels panel). `mask` is document-sized, gray in R (255 = selected). */
export interface AlphaChannel {
  id: string;
  name: string;
  mask: Raster;
  /** Overlay color shown when the channel is viewed together with the composite. */
  color: RGBA;
  /** Overlay opacity 0..1. */
  opacity: number;
}

/**
 * Quick Mask mode state. While `active`, `raster` (document-sized, gray in R, 255 =
 * selected) is the editable selection; the compositor tints the *masked* (unselected)
 * areas with `color` at `opacity` (or the selected areas when `maskedAreas` is false).
 */
export interface QuickMask {
  active: boolean;
  raster: Raster | null;
  color: RGBA;
  opacity: number;
  /** PS "Color Indicates: Masked Areas" (default) vs "Selected Areas". */
  maskedAreas: boolean;
}

/** Document-level metadata persisted to `manifest.json`. Open-ended for other agents. */
export interface DocumentMeta {
  /** Pixels per inch (informational). */
  dpi: number;
  createdAt: number;
  modifiedAt: number;
  /** Absolute path of the backing `.pfproj` / image, or `null` for unsaved docs. */
  path: string | null;
  /** Free-form extension slot (AI history, UI state, ...). */
  [key: string]: unknown;
}

/**
 * The live document. A plain mutable object: commands mutate it, stores wrap it and bump
 * a version counter. Never hold a reference to `layers` across a command; re-read it.
 */
export interface Document {
  readonly id: string;
  name: string;
  width: number;
  height: number;
  /** Bottom to top. See module header for group layout. */
  layers: Layer[];
  /** Always `width x height`. An empty selection means "whole canvas" for most tools. */
  selection: Selection;
  activeLayerId: LayerId | null;
  /** True when there are unsaved changes. */
  dirty: boolean;
  meta: DocumentMeta;
  /** Saved selections (Channels panel). */
  alphaChannels: AlphaChannel[];
  /** Quick Mask mode (transient, not saved). */
  quickMask: QuickMask;
  /** Vector paths (Paths panel). */
  paths: Path[];
  /** Id of the "Work Path" in `paths`, or null. */
  workPathId: string | null;
}

/**
 * Undoable unit of work. `do` is called by `History.push` (unless already applied) and by
 * redo; `undo` reverses it exactly. Commands own their snapshots and report their size so
 * the history can enforce its memory budget.
 */
export interface Command {
  readonly label: string;
  do(doc: Document): void;
  undo(doc: Document): void;
  /**
   * Try to absorb `next` (pushed immediately after this command) into this one, e.g.
   * successive opacity slider ticks. Return `true` if absorbed; `next` is then dropped.
   */
  mergeWith?(next: Command): boolean;
  /** Approximate bytes of snapshots held. Defaults to 0 when absent. */
  byteSize?(): number;
  /**
   * Layers whose **pixels** this command writes in place (both on `do` and `undo`), with
   * the raster-space rect touched (omit for the whole layer). Stores forward these to
   * `ICompositor.markDirty` after every do/undo/redo. Commands that only swap `raster`
   * objects or change props/structure need not report: the compositor detects those.
   */
  affected?(): readonly LayerDirtyRegion[];
}

/** A dirty region on one layer, in that layer's raster space. */
export interface LayerDirtyRegion {
  layerId: LayerId;
  rect?: Rect;
}

/** A history entry as shown in the History panel. */
export interface HistoryEntry {
  readonly label: string;
  readonly command: Command;
  readonly bytes: number;
  /** Monotonic id, stable across eviction. */
  readonly seq: number;
}

/** A History panel snapshot (camera button). */
export interface HistorySnapshot {
  readonly id: string;
  name: string;
  /** `History.index` when the snapshot was taken (adjusted on eviction). */
  historyIndex: number;
  /** Bytes held by the snapshot's rasters. */
  readonly bytes: number;
  readonly createdAt: number;
}

/** History Brush source: a snapshot or a history state. */
export type HistorySource = { kind: "snapshot"; id: string } | { kind: "state"; index: number };

/** Pan/zoom/rotation of the document inside the canvas, in CSS pixels. */
export interface ViewportState {
  /** Scale factor, 1 = 100 %. */
  zoom: number;
  /** Screen x (CSS px) of the document origin. */
  panX: number;
  /** Screen y (CSS px) of the document origin. */
  panY: number;
  /** View rotation in radians, clockwise positive (screen y is down). */
  rotation: number;
}

export type CompositorKind = "webgl2" | "canvas2d";

/**
 * Channel view mode: `"rgb"` the composite; `"r"`/`"g"`/`"b"` one channel as grayscale;
 * `"alpha:<channelId>"` an alpha channel; `"mask"` the active layer's mask.
 */
export type ViewChannel = "rgb" | "r" | "g" | "b" | `alpha:${string}` | "mask";

/** Per-frame options for {@link ICompositor.render}. */
export interface RenderOptions {
  /** Backing-store size of the canvas in device pixels. Defaults to the canvas's size. */
  width?: number;
  height?: number;
  /** Device pixel ratio applied on top of the viewport (CSS px -> device px). Default 1. */
  dpr?: number;
  /** Draw the animated selection outline. Default true. */
  showSelection?: boolean;
  /** Marching-ants phase in screen px; advance ~1 px every 50-100 ms. Default 0. */
  antsPhase?: number;
  /** Draw a pixel grid at zoom >= `pixelGridMinZoom`. Default true. */
  showPixelGrid?: boolean;
  /** Default 8 (800 %). */
  pixelGridMinZoom?: number;
  /** Checkerboard cell size in device px. Default 8. */
  checkerSize?: number;
  /**
   * The layer the user is editing. Lets the GL compositor keep a cache of the layers
   * below it so brush strokes re-composite only the layers above.
   */
  activeLayerId?: LayerId | null;
  /** Force a full re-composite this frame (debugging / after context restore). */
  forceFull?: boolean;
  /** Channel view (Channels panel). Default `"rgb"`. */
  viewChannel?: ViewChannel;
  /** Overlay the document's quick mask when active. Default true. */
  showQuickMask?: boolean;
}

/** What a `render` call did; useful for stats overlays and tests. */
export interface RenderStats {
  /** False when the frame was skipped (e.g. context lost). */
  drawn: boolean;
  /** True when the layer stack was re-composited (not just re-presented). */
  recomposited: boolean;
  /** Area in doc pixels that was re-composited (0 when nothing changed). */
  compositedArea: number;
  /** Number of blend passes executed. */
  passes: number;
  /** Number of layer texture uploads (full or partial). */
  uploads: number;
}

/** Compositor contract: one instance per canvas element. */
export interface ICompositor {
  readonly kind: CompositorKind;
  /** Draw the document through the viewport into the canvas. Cheap when nothing changed. */
  render(doc: Document, viewport: Viewport, opts?: RenderOptions): RenderStats;
  /**
   * Tell the compositor that pixels of `layerId` changed inside `rect` (raster-space,
   * relative to the layer's own origin). Omit `rect` for the whole layer. Property changes
   * (opacity, visibility, offset, order, effects, masks, ...) are detected automatically
   * on `render`. The compositor expands the rect by the layer's effect extent itself.
   */
  markDirty(layerId: LayerId, rect?: Rect): void;
  /** Drop every cache; next render re-uploads and re-composites everything. */
  invalidateAll(): void;
  /** True when the GL context is currently lost (renders are skipped). */
  isContextLost(): boolean;
  /** Release GPU/CPU resources; the instance is unusable afterwards. */
  dispose(): void;
}
