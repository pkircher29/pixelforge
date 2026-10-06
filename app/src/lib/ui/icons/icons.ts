/**
 * Pixelforge glyph set — hand-drawn 16×16 icons in Photoshop's visual language.
 *
 * Every glyph is a list of parts on a 16×16 grid. A part is stroked with `currentColor`
 * (1.25 px, round joins) unless `f` (fill with currentColor) or `k` (knock-out: fill with
 * the surface colour, `--icon-knockout`) is set. `da` = dash pattern, `w` = stroke width
 * override, `o` = opacity. Lines sit on half-pixel coordinates so they stay crisp at 1×.
 *
 * Names: tool ids from PLAN-v2 §2 (every flyout member), toolbar extras, options-bar,
 * layers-panel, panel-tab and misc glyphs. `ICON_ALIASES` maps legacy tool ids.
 */

export interface IconPart {
  d: string;
  /** Fill with currentColor (no stroke unless `s` is also set). */
  f?: boolean;
  /** Fill with the surface colour (knock-out) and stroke. */
  k?: boolean;
  /** Also stroke a filled part. */
  s?: boolean;
  /** Dash array ("2 1.5"). */
  da?: string;
  /** Stroke width override. */
  w?: number;
  /** Opacity 0..1. */
  o?: number;
}

export type IconDef = readonly IconPart[];

const S = (d: string, extra: Omit<IconPart, "d"> = {}): IconPart => ({ d, ...extra });
const F = (d: string, extra: Omit<IconPart, "d"> = {}): IconPart => ({ d, f: true, ...extra });
const K = (d: string, extra: Omit<IconPart, "d"> = {}): IconPart => ({ d, k: true, ...extra });

const DASH = "2 1.6";

// Shared fragments.
const BANDAID = "M4.2 9.2l5-5a2.2 2.2 0 013.1 3.1l-5 5a2.2 2.2 0 01-3.1-3.1z";
const BANDAID_DOTS = "M7.3 7.3h.01M8.7 8.7h.01M8.7 6.4h.01M7.3 9.6h.01";
const ERASER = "M2.5 11.2l6.2-6.2 3.9 3.9-4.6 4.6H5.4z";
const ERASER_SPLIT = "M6.3 7.4l3.9 3.9";
const NIB = "M8 1.6l3.6 7L8 14.4 4.4 8.6z";
const NIB_SLIT = "M8 9.6v4.8";
const NIB_EYE = "M8 9.8a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6z";
const SERIF_T = "M3.2 2.8h9.6v2.6h-1.2V4.2H8.9v8.4h1.5v1.1H5.6v-1.1h1.5V4.2H4.4v1.2H3.2z";
const BRUSH_HANDLE = "M13.6 2.4L8.3 7.7";
const BRUSH_TIP =
  "M7.9 7.3c.8.6 1 1.6.5 2.6-.6 1.3-2 2.3-3.6 2.8-.9.3-1.9.4-2.7.2.6-.6.9-1.3 1-2.1.1-1.5.9-2.7 2.1-3.3.9-.5 2-.7 2.7-.2z";
const MAGNIFIER = "M6.5 10.5a4 4 0 100-8 4 4 0 000 8z";
const MAGNIFIER_HANDLE = "M9.4 9.4l4.3 4.3";
const EYE = "M1.5 8c1.9-3.4 4.1-5 6.5-5s4.6 1.6 6.5 5c-1.9 3.4-4.1 5-6.5 5S3.4 11.4 1.5 8z";
const STAMP = "M5 9.5V7.8a3 3 0 016 0v1.7";
const STAMP_BASE = "M2.6 9.5h10.8v2.6H2.6z";
const STAMP_FOOT = "M4.2 12.1v1.7h7.6v-1.7";
const HAND =
  "M5.6 8.4V3.7a1 1 0 012 0V8M7.6 7.6V2.6a1 1 0 012 0v5.1M9.6 7.6V3.7a1 1 0 012 0v4.4M11.6 8.8V6.4a1 1 0 012 0v4c0 2.4-2 3.9-4.6 3.9-2.3 0-3.7-.9-4.7-2.6L2.5 9a1 1 0 011.6-1.1l1.5 1.8";
const ARROW_FILLED = "M4.2 2.2l8 6.3-3.9.9 2.4 4.1-1.6.9-2.4-4.1-2.5 3z";

export const ICONS: Record<string, IconDef> = {
  // ------------------------------------------------------------------ tools §2
  move: [S("M8 2.2v11.6M2.2 8h11.6"), S("M6.3 3.9L8 2.2l1.7 1.7M6.3 12.1L8 13.8l1.7-1.7M3.9 6.3L2.2 8l1.7 1.7M12.1 6.3L13.8 8l-1.7 1.7")],
  artboard: [S("M4.5 1.5v13M11.5 1.5v13M1.5 4.5h13M1.5 11.5h13")],
  "marquee-rect": [S("M2.5 2.5h11v11h-11z", { da: DASH })],
  "marquee-ellipse": [S("M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z", { da: DASH })],
  "marquee-row": [S("M1.5 6.5h13v3h-13z", { da: DASH })],
  "marquee-column": [S("M6.5 1.5h3v13h-3z", { da: DASH })],
  lasso: [
    S("M8.2 2.6c-3.2 0-5.7 1.6-5.7 3.7 0 2 2.5 3.7 5.7 3.7s5.7-1.7 5.7-3.7c0-2.1-2.5-3.7-5.7-3.7z"),
    S("M4.6 9.3c-.9.6-1.3 1.3-1.1 2.1.3.9 1.4 1.3 1.5 2.3"),
  ],
  "lasso-polygon": [S("M3 5.2l5.2-2.7L13.3 6l-2.1 5.6H4.8z"), S("M4.8 11.6c-.6.8-1 1.5-.8 2.2")],
  "lasso-magnetic": [
    S("M9 2.6C6.3 2.6 4.1 4 4.1 5.8c0 1.8 2.2 3.2 4.9 3.2s4.9-1.4 4.9-3.2c0-1.8-2.2-3.2-4.9-3.2z"),
    S("M2.2 9.8v2.1a2.6 2.6 0 005.2 0V9.8"),
    S("M2.2 10.8h1.8M5.6 10.8h1.8"),
  ],
  "quick-select": [S("M6 13.6a3.8 3.8 0 100-7.6 3.8 3.8 0 000 7.6z", { da: DASH }), S("M8.7 7.3l4.9-4.9"), F("M8.1 6.6l1.3 1.3-.8.8-1.3-1.3z")],
  wand: [S("M2.6 13.4l6.9-6.9"), S("M11.3 1.8v2.2M11.3 7.2v2.2M8.2 5.6h2.2M12.2 5.6h2.2M9.1 3.4l1.2 1.2M12.3 3.4l-1.2 1.2M9.1 7.8l1.2-1.2M12.3 7.8l-1.2-1.2")],
  crop: [S("M4.5 1.5v10h10M1.5 4.5h10v10")],
  "crop-perspective": [S("M3.2 13.5L5.3 3h5.4l2.1 10.5z"), S("M1.5 13.5h13M1.5 3h13", { o: 0.55 })],
  slice: [S("M2.4 13.6l4.2-4.2", { w: 1.8 }), S("M6.6 9.4L12 4l2 2-5.4 5.4z"), S("M9.6 6.4l2 2"), S("M12 4l1.6-1.6", { w: 1 })],
  eyedropper: [S("M2.5 13.5l6.3-6.3"), S("M8.1 6.5l1.4 1.4"), S("M9.6 4.6l2-2a1.5 1.5 0 012.1 2.1l-2 2z"), S("M3 11l-.5 2.5 2.5-.5")],
  "color-sampler": [S("M2.5 13.5l5-5"), S("M7 7.8l1.1 1.1"), S("M8.3 6.3l1.6-1.6a1.3 1.3 0 011.8 1.8l-1.6 1.6z"), S("M3 11l-.5 2.5 2.5-.5"), S("M12 14a2 2 0 100-4 2 2 0 000 4z"), F("M12 12.6a.6.6 0 100-1.2.6.6 0 000 1.2z")],
  ruler: [S("M2 11.4L11.4 2l2.6 2.6L4.6 14z"), S("M5.4 8.6l1.4 1.4M7.4 6.6l1.4 1.4M9.4 4.6l1.4 1.4")],
  note: [S("M2.5 2.5h11v7.5h-5.5l-3 3v-3h-2.5z"), S("M5 5.5h6M5 7.8h4")],
  "healing-spot": [S(BANDAID), S(BANDAID_DOTS, { w: 1.6 }), S("M3.8 3.8a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z", { da: "1.4 1.2", o: 0.9 })],
  "healing-brush": [S(BANDAID), S(BANDAID_DOTS, { w: 1.6 })],
  patch: [S("M3.5 3.5h9v9h-9z", { da: "1.5 1.5" }), S("M5.5 5.5h5v5h-5z")],
  "content-aware-move": [S("M2.5 2.5h6v6h-6z", { da: DASH }), S("M6 10l4-4"), S("M10 6l-.3 2.7M10 6L7.3 6.3", { w: 1.1 }), S("M10.5 7.5h3v6h-3M8.5 13.5h2")],
  "red-eye": [S(EYE), S("M8 10.4a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z"), S("M8 6.4v3.2M6.4 8h3.2")],
  brush: [S(BRUSH_HANDLE, { w: 1.6 }), F(BRUSH_TIP)],
  pencil: [S("M3 13l.6-3.2L11 2.4l2.6 2.6-7.4 7.4z"), S("M9.6 3.8l2.6 2.6M3.6 9.8l2.6 2.6")],
  "color-replacement": [S("M12.6 2.4L7.3 7.7", { w: 1.6 }), F("M6.9 7.3c.8.6 1 1.6.5 2.6-.6 1.3-2 2.3-3.6 2.8-.9.3-1.9.4-2.7.2.6-.6.9-1.3 1-2.1.1-1.5.9-2.7 2.1-3.3.9-.5 2-.7 2.7-.2z"), S("M10.5 10.5h4v4h-4z"), F("M10.5 10.5h4l-4 4z")],
  "mixer-brush": [S(BRUSH_HANDLE, { w: 1.6 }), F(BRUSH_TIP), S("M12.4 9.6c-.8 1.2-1.4 2-1.4 2.8a1.4 1.4 0 002.8 0c0-.8-.6-1.6-1.4-2.8z")],
  clone: [S(STAMP), S(STAMP_BASE), S(STAMP_FOOT)],
  "pattern-stamp": [S(STAMP), S(STAMP_BASE), S(STAMP_FOOT), F("M4 10.2h1.8v1.3H4zM7.1 10.2h1.8v1.3H7.1zM10.2 10.2H12v1.3h-1.8z")],
  "history-brush": [S("M2.8 7.4a5.2 5.2 0 019.6-2.2"), S("M12.6 2.6v2.8H9.8"), S("M13.2 8.6a5.2 5.2 0 01-1.6 3.4"), S("M3.4 9.6l4.4 1.2"), F("M7.6 10.2c.5.4.6 1 .3 1.6-.4.8-1.3 1.4-2.3 1.7-.6.2-1.2.3-1.7.1.4-.4.6-.8.6-1.3.1-.9.6-1.7 1.3-2 .6-.3 1.3-.4 1.8-.1z")],
  "art-history-brush": [S("M2.8 7.4a5.2 5.2 0 019.6-2.2"), S("M12.6 2.6v2.8H9.8"), S("M5.6 10.8c1-.9 1.6-.9 2.4 0s1.4.9 2.4 0 1.6-.9 2.4 0"), F("M4.6 11.4c.4.3.5.8.2 1.3-.3.6-1 1.1-1.8 1.3-.5.1-1 .2-1.3.1.3-.3.5-.6.5-1 .1-.7.5-1.3 1-1.6.5-.2 1-.3 1.4-.1z")],
  eraser: [S(ERASER), S(ERASER_SPLIT)],
  "background-eraser": [S(ERASER), S(ERASER_SPLIT), S("M12.6 2.2l1.6 1.6M14.2 2.2l-1.6 1.6", { w: 1.1 })],
  "magic-eraser": [S(ERASER), S(ERASER_SPLIT), S("M12.6 1.4v1.6M12.6 4.6v1.6M10.4 3.8H12M13.2 3.8h1.6", { w: 1.1 })],
  gradient: [F("M2.5 3.5h3.7v9H2.5z"), F("M6.2 3.5h3.6v9H6.2z", { o: 0.5 }), F("M9.8 3.5h3.7v9H9.8z", { o: 0.18 }), S("M2.5 3.5h11v9h-11z")],
  bucket: [S("M2.6 7.4l4.9-4.9 5.4 5.4-4.9 4.9z"), S("M4.2 5.8l6.6 1.6"), S("M7.5 2.5V1.2"), S("M13.3 9.2c-.5 1.3-1.2 2.3-1.2 3.1a1.2 1.2 0 002.4 0c0-.8-.7-1.8-1.2-3.1z")],
  blur: [S("M8 2.4c2 3 4 5 4 7.5a4 4 0 01-8 0c0-2.5 2-4.5 4-7.5z")],
  sharpen: [S("M8 2.4l5.2 11.2H2.8z"), S("M8 6.8l2.4 5.2")],
  smudge: [
    S("M6 8.6V3a1 1 0 012 0v5M8 7.3V5.4a1 1 0 012 0v2.4M10 8.6V7.2a1 1 0 012 0v3.6c0 2-1.6 3.6-4.2 3.6-2.1 0-3.4-.9-4.3-2.5L2.3 9.8A1 1 0 013.9 8.7L5.2 10"),
    S("M6 13.6c.6.8 1.3 1 1.9.4", { o: 0.7 }),
  ],
  dodge: [F("M5.6 9.4a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z"), S("M8.2 8.2l5.4 5.4", { w: 1.6 })],
  burn: [S("M8 11.6a3.6 3.6 0 100-7.2 3.6 3.6 0 000 7.2z"), S("M6 4.6V2.4M8 4.2V1.8M10 4.6V2.4"), S("M5 11c.3 2 1.4 3.4 3 3.4s2.7-1.4 3-3.4")],
  sponge: [S("M3.4 4.5h9.2a1.8 1.8 0 011.8 1.8v3.4a1.8 1.8 0 01-1.8 1.8H3.4a1.8 1.8 0 01-1.8-1.8V6.3a1.8 1.8 0 011.8-1.8z"), S("M4.6 6.8h.01M7.4 9.4h.01M9.4 6.6h.01M11.8 9h.01M6.2 7.9h.01", { w: 1.5 })],
  pen: [S(NIB), S(NIB_SLIT), S(NIB_EYE)],
  "pen-freeform": [S("M9.5 1.6l3 5.8-3 5.4-3-5.4z"), S("M9.5 8.2v4.6"), S("M9.5 8.3a1 1 0 100-2 1 1 0 000 2z"), S("M1.6 13.2c1.4-2.6 2.6-2.6 3.6-.6s2-.8 3.2-3.4")],
  "pen-curvature": [S("M9.5 1.6l3 5.8-3 5.4-3-5.4z"), S("M9.5 8.2v4.6"), S("M9.5 8.3a1 1 0 100-2 1 1 0 000 2z"), S("M1.6 13.6c0-5 2.6-8 6-8.6"), S("M1.6 13.6h.01M7.6 5h.01", { w: 2.2 })],
  "pen-add": [S(NIB), S(NIB_SLIT), S(NIB_EYE), S("M12.5 9.5v4M10.5 11.5h4", { w: 1.3 })],
  "pen-delete": [S(NIB), S(NIB_SLIT), S(NIB_EYE), S("M10.5 11.5h4", { w: 1.3 })],
  "pen-convert": [S("M3 12.2L8 4.4l5 7.8"), K("M8 5.6a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6z", { s: true }), S("M3 12.2h.01M13 12.2h.01", { w: 2 })],
  "type-h": [F(SERIF_T)],
  "type-v": [F("M2.2 2.8h8.2v2.6h-1V4.2H7.2v8.4h1.3v1.1H4.1v-1.1h1.3V4.2H3.2v1.2h-1z"), S("M13 2.6v10.6"), S("M11.4 11.6l1.6 1.6 1.6-1.6")],
  "type-mask-h": [S(SERIF_T, { da: "1.6 1.2", w: 1 })],
  "type-mask-v": [S("M2.2 2.8h8.2v2.6h-1V4.2H7.2v8.4h1.3v1.1H4.1v-1.1h1.3V4.2H3.2v1.2h-1z", { da: "1.6 1.2", w: 1 }), S("M13 2.6v10.6"), S("M11.4 11.6l1.6 1.6 1.6-1.6")],
  "path-select": [F(ARROW_FILLED)],
  "direct-select": [S(ARROW_FILLED)],
  "shape-rect": [S("M2.5 3.5h11v9h-11z")],
  "shape-rounded": [S("M4.5 3.5h7a2 2 0 012 2v5a2 2 0 01-2 2h-7a2 2 0 01-2-2v-5a2 2 0 012-2z")],
  "shape-ellipse": [S("M8 13a6 5 0 100-10 6 5 0 000 10z")],
  "shape-polygon": [S("M8 2l6.2 4.5-2.4 7.3H4.2L1.8 6.5z")],
  "shape-line": [S("M2.5 13.5l11-11")],
  "shape-custom": [F("M8 2.2c1.5 0 1.9 1.8 3.4 2.1 1.5.3 2.4 2 1.4 3.2-.8 1-.3 2.9-1.6 3.4-1.4.5-2 2.5-3.2 2.5s-1.8-2-3.2-2.5c-1.3-.5-.8-2.4-1.6-3.4-1-1.2-.1-2.9 1.4-3.2C6.1 4 6.5 2.2 8 2.2z")],
  hand: [S(HAND)],
  "rotate-view": [S("M12.6 8.6a4.8 4.8 0 11-1.6-4.2"), S("M12.6 2.4v3h-3"), F("M8 9.4a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8z")],
  zoom: [S(MAGNIFIER), S(MAGNIFIER_HANDLE, { w: 1.6 }), S("M6.5 4.4v4.2M4.4 6.5h4.2")],

  // ------------------------------------------------------------------ toolbar extras
  "swap-colors": [S("M3.2 9.4a5.8 5.8 0 015.8-5.8"), S("M7.2 1.8l1.9 1.8-1.9 1.8"), S("M12.8 6.6a5.8 5.8 0 01-5.8 5.8"), S("M8.8 14.2L6.9 12.4l1.9-1.8")],
  "default-colors": [F("M6.5 6.5h8v8h-8z"), K("M1.5 1.5h8v8h-8z", { s: true })],
  "quick-mask": [S("M1.5 1.5h13v13h-13z"), S("M8 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z")],
  "quick-mask-on": [S("M1.5 1.5h13v13h-13z"), F("M8 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z")],
  "screen-mode": [S("M1.5 2.5h13v11h-13z"), S("M1.5 5.5h13"), S("M3.5 4h.01M5.5 4h.01", { w: 1.6 })],
  "screen-mode-menubar": [S("M1.5 2.5h13v11h-13z"), S("M1.5 5.5h13")],
  "screen-mode-full": [S("M1.5 2.5h13v11h-13z"), S("M4.5 5.5h7v5h-7z", { da: "1.4 1.2", w: 1 })],
  "edit-toolbar": [F("M3.3 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM8 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM12.7 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z")],

  // ------------------------------------------------------------------ options bar
  "preset-picker": [S("M2.5 2.5h8v8h-8z"), F("M9.5 10.5l5 0-2.5 3z")],
  "sel-new": [S("M2.5 2.5h8v8h-8z")],
  "sel-add": [F("M2.5 2.5h7.5v3H13v7.5H5.5V10H2.5z"), S("M2.5 2.5h7.5v7.5H2.5z"), S("M5.5 5.5H13V13H5.5z")],
  "sel-subtract": [F("M2.5 2.5h7.5v7.5H2.5z"), K("M5.5 5.5H13V13H5.5z", { s: true })],
  "sel-intersect": [F("M5.5 5.5h4.5v4.5H5.5z"), S("M2.5 2.5h7.5v7.5H2.5z"), S("M5.5 5.5H13V13H5.5z")],
  "align-left": [S("M2.5 1.5v13"), F("M4.5 3.5h8v3h-8zM4.5 9.5h5v3h-5z")],
  "align-hcenter": [S("M8 1.5v13"), F("M3.5 3.5h9v3h-9zM5.5 9.5h5v3h-5z")],
  "align-right": [S("M13.5 1.5v13"), F("M3.5 3.5h8v3h-8zM6.5 9.5h5v3h-5z")],
  "align-top": [S("M1.5 2.5h13"), F("M3.5 4.5h3v8h-3zM9.5 4.5h3v5h-3z")],
  "align-vcenter": [S("M1.5 8h13"), F("M3.5 3.5h3v9h-3zM9.5 5.5h3v5h-3z")],
  "align-bottom": [S("M1.5 13.5h13"), F("M3.5 3.5h3v8h-3zM9.5 6.5h3v5h-3z")],
  "distribute-h": [S("M1.5 1.5v13M14.5 1.5v13"), F("M4 4.5h2v7H4zM7 4.5h2v7H7zM10 4.5h2v7h-2z")],
  "distribute-v": [S("M1.5 1.5h13M1.5 14.5h13"), F("M4.5 4h7v2h-7zM4.5 7h7v2h-7zM4.5 10h7v2h-7z")],
  "brush-size": [S("M8 13.2a5.2 5.2 0 100-10.4 5.2 5.2 0 000 10.4z"), S("M8 6.8v2.4M6.8 8h2.4")],
  workspace: [S("M1.5 2.5h13v11h-13z"), S("M9.5 2.5v11M9.5 8h5")],

  // ------------------------------------------------------------------ layers panel
  eye: [S(EYE), F("M8 10.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z")],
  "eye-off": [S(EYE), S("M8 10.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z"), S("M2.5 13.5l11-11")],
  "lock-transparent": [S("M2.5 2.5h11v11h-11z"), F("M2.5 2.5h3.67v3.67H2.5zM9.83 2.5h3.67v3.67H9.83zM6.17 6.17h3.66v3.66H6.17zM2.5 9.83h3.67v3.67H2.5zM9.83 9.83h3.67v3.67H9.83z")],
  "lock-pixels": [S("M13.2 2.8L8.6 7.4", { w: 1.5 }), F("M8.2 7.1c.7.5.9 1.4.4 2.3-.5 1.1-1.7 2-3.1 2.4-.8.3-1.6.4-2.3.2.5-.5.8-1.1.9-1.8.1-1.3.8-2.3 1.8-2.8.8-.4 1.7-.6 2.3-.3z")],
  "lock-position": [S("M8 2.6v10.8M2.6 8h10.8"), S("M6.5 4.1L8 2.6l1.5 1.5M6.5 11.9L8 13.4l1.5-1.5M4.1 6.5L2.6 8l1.5 1.5M11.9 6.5L13.4 8l-1.5 1.5")],
  "lock-artboard": [S("M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13")],
  "lock-all": [S("M4.5 7.5V5.8a3.5 3.5 0 017 0v1.7"), S("M3.5 7.5h9v6.5h-9z"), F("M8 11.4a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z")],
  lock: [S("M5 7.5V5.6a3 3 0 016 0v1.9"), S("M4 7.5h8v6H4z"), F("M8 11.3a1 1 0 100-2 1 1 0 000 2z")],
  unlock: [S("M5 7.5V5.6a3 3 0 015.8-1"), S("M4 7.5h8v6H4z"), F("M8 11.3a1 1 0 100-2 1 1 0 000 2z")],
  chain: [S("M6.4 9.6l3.2-3.2"), S("M5.4 11.2l-.9.9a2.4 2.4 0 01-3.4-3.4l2.1-2.1a2.4 2.4 0 013.4 0"), S("M10.6 4.8l.9-.9a2.4 2.4 0 013.4 3.4l-2.1 2.1a2.4 2.4 0 01-3.4 0")],
  "chain-off": [S("M5.4 11.2l-.9.9a2.4 2.4 0 01-3.4-3.4l2.1-2.1a2.4 2.4 0 013.4 0"), S("M10.6 4.8l.9-.9a2.4 2.4 0 013.4 3.4l-2.1 2.1a2.4 2.4 0 01-3.4 0"), S("M3 3l10 10")],
  fx: [S("M3.2 7h4.2M7.4 3.4c-1.5-.5-2.4.3-2.4 2v8", { w: 1.3 }), S("M8.8 7.2l4.6 6.2M13.4 7.2l-4.6 6.2", { w: 1.3 })],
  mask: [S("M1.5 2.5h13v11h-13z"), S("M8 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z")],
  "mask-filled": [F("M1.5 2.5h13v11h-13z"), K("M8 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z")],
  adjustment: [S("M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z"), F("M8 2.5a5.5 5.5 0 010 11z")],
  folder: [S("M1.5 3.5h4.6l1.6 2h6.8v7.5H1.5z"), S("M1.5 6.5h13")],
  "folder-open": [S("M1.5 3.5h4.6l1.6 2h6.8v2"), S("M1.5 13V6.5h13l-1.8 6.5z")],
  "new-layer": [S("M3.5 1.5h6l3.5 3.5v9.5h-9.5z"), S("M9.5 1.5v3.5h3.5")],
  trash: [S("M2.8 4.5h10.4"), S("M6.3 4.5V3h3.4v1.5"), S("M4.3 4.5l.6 9.5h6.2l.6-9.5"), S("M6.8 7v4.5M9.2 7v4.5")],
  "kind-pixel": [S("M2.5 3.5h11v9h-11z"), S("M3.5 11.4l3-3.4 2.4 2.4 2-2 2.6 3"), F("M10.6 6.6a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z")],
  "kind-adjust": [S("M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11z"), F("M8 2.5a5.5 5.5 0 010 11z")],
  "kind-type": [F("M3.2 2.8h9.6v2.6h-1.2V4.2H8.9v8.4h1.5v1.1H5.6v-1.1h1.5V4.2H4.4v1.2H3.2z")],
  "kind-shape": [S("M2.5 2.5h7v7h-7z"), K("M10.2 13.6a3.4 3.4 0 100-6.8 3.4 3.4 0 000 6.8z", { s: true })],
  "kind-smart": [S("M2.5 2.5h11v11h-11z"), F("M8.5 8.5h5v5h-5z")],
  search: [S(MAGNIFIER), S(MAGNIFIER_HANDLE, { w: 1.6 })],
  "clip-arrow": [S("M4.5 2v9.5h7"), S("M9.5 9l2.5 2.5L9.5 14")],
  "layer-thumb-border": [S("M1.5 1.5h13v13h-13z")],

  // ------------------------------------------------------------------ panel tabs
  "panel-menu": [F("M1.6 4.4L3.6 7l2-2.6z"), S("M7 4.5h7.4M7 8h7.4M7 11.5h7.4")],
  "collapse-left": [S("M8.5 3.5L4 8l4.5 4.5M13 3.5L8.5 8l4.5 4.5")],
  "collapse-right": [S("M7.5 3.5L12 8l-4.5 4.5M3 3.5L7.5 8 3 12.5")],
  close: [S("M3.5 3.5l9 9M12.5 3.5l-9 9")],
  "close-small": [S("M5 5l6 6M11 5l-6 6", { w: 1.1 })],

  // ------------------------------------------------------------------ misc
  "chevron-down": [F("M3.5 5.5h9L8 11z")],
  "chevron-right": [F("M5.5 3.5v9L11 8z")],
  "chevron-up": [F("M3.5 10.5h9L8 5z")],
  "chevron-left": [F("M10.5 3.5v9L5 8z")],
  caret: [F("M4.5 6.5h7L8 10.5z")],
  "caret-small": [F("M5.5 7h5L8 10z")],
  check: [S("M2.8 8.4l3.3 3.3 7.1-7.1", { w: 1.5 })],
  radio: [F("M8 11a3 3 0 100-6 3 3 0 000 6z")],
  warning: [S("M8 2.2l6.4 11.3H1.6z"), S("M8 6.5v3.4"), S("M8 11.8h.01", { w: 1.8 })],
  info: [S("M8 14a6 6 0 100-12 6 6 0 000 12z"), S("M8 7.2v4"), S("M8 5h.01", { w: 1.8 })],
  error: [S("M8 14a6 6 0 100-12 6 6 0 000 12z"), S("M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4")],
  success: [S("M8 14a6 6 0 100-12 6 6 0 000 12z"), S("M5 8.2l2.1 2.1 4-4.1")],
  plus: [S("M8 3v10M3 8h10")],
  minus: [S("M3 8h10")],
  snapshot: [S("M1.5 5h3l1.4-2h4.2L11.5 5h3v8.5h-13z"), S("M8 11.3a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z")],
  "history-source": [S("M3 7.8a5 5 0 019.2-2.2"), S("M12.8 2.8v2.8H10"), S("M13 8.4a5 5 0 01-5 5"), F("M3.2 10.6c.6.4.8 1.1.4 1.8-.4.8-1.3 1.4-2.3 1.6.4-.5.6-.9.6-1.4.1-1 .5-1.7 1.3-2z")],
  play: [F("M4.5 2.5l9 5.5-9 5.5z")],
  stop: [F("M3.5 3.5h9v9h-9z")],
  filter: [S("M1.5 2.5h13L9.5 8.4V13l-3 1.5V8.4z")],
  gear: [S("M8 10.6a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z"), S("M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4")],
  undo: [S("M6 4.5L2.5 8 6 11.5"), S("M2.5 8h7a4 4 0 010 8h-1", { w: 1.25 })],
  redo: [S("M10 4.5L13.5 8 10 11.5"), S("M13.5 8h-7a4 4 0 000 8h1")],
  grip: [F("M5.5 3.5h2v2h-2zM8.5 3.5h2v2h-2zM5.5 7h2v2h-2zM8.5 7h2v2h-2zM5.5 10.5h2v2h-2zM8.5 10.5h2v2h-2z")],
  pin: [S("M9.5 2l4.5 4.5-2.5.5-2 2L9 12.5 6.5 10 2 14.5l4.5-4.5L4 6.5l3.5-.5 2-2z")],
  link: [S("M6.4 9.6l3.2-3.2"), S("M5.4 11.2l-.9.9a2.4 2.4 0 01-3.4-3.4l2.1-2.1a2.4 2.4 0 013.4 0"), S("M10.6 4.8l.9-.9a2.4 2.4 0 013.4 3.4l-2.1 2.1a2.4 2.4 0 01-3.4 0")],
  document: [S("M3.5 1.5h6l3.5 3.5v9.5h-9.5z"), S("M9.5 1.5v3.5h3.5"), S("M5.5 8h5M5.5 10.5h5")],
  "document-new": [S("M3.5 1.5h6l3.5 3.5v9.5h-9.5z"), S("M9.5 1.5v3.5h3.5"), S("M8 7v5M5.5 9.5h5")],
  image: [S("M2.5 3.5h11v9h-11z"), S("M3.5 11.4l3-3.4 2.4 2.4 2-2 2.6 3"), F("M10.6 6.6a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z")],
  clock: [S("M8 14a6 6 0 100-12 6 6 0 000 12z"), S("M8 4.5V8l2.5 1.5")],
  "zoom-in": [S(MAGNIFIER), S(MAGNIFIER_HANDLE, { w: 1.6 }), S("M6.5 4.4v4.2M4.4 6.5h4.2")],
  "zoom-out": [S(MAGNIFIER), S(MAGNIFIER_HANDLE, { w: 1.6 }), S("M4.4 6.5h4.2")],
  "app-mark": [F("M2 2h5.5v5.5H2zM8.5 8.5H14V14H8.5z"), S("M8.5 2H14v5.5H8.5zM2 8.5h5.5V14H2z", { o: 0.55 })],
  ellipsis: [F("M3.3 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM8 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM12.7 9.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z")],
  "window-min": [S("M3 8.5h10", { w: 1 })],
  "window-max": [S("M3.5 3.5h9v9h-9z", { w: 1 })],
  "window-restore": [S("M3.5 5.5h7v7h-7zM5.5 5.5v-2h7v7h-2", { w: 1 })],
  "window-close": [S("M3.5 3.5l9 9M12.5 3.5l-9 9", { w: 1 })],
  "swatch-fg": [F("M1.5 1.5h13v13h-13z")],
  color: [S("M8 14a6 6 0 100-12 6 6 0 000 12z"), S("M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4", { o: 0.6 })],
  swatches: [F("M1.5 1.5h4v4h-4zM6 1.5h4v4H6zM10.5 1.5h4v4h-4zM1.5 6h4v4h-4zM6 6h4v4H6z"), S("M10.5 6h4v4h-4zM1.5 10.5h4v4h-4zM6 10.5h4v4H6zM10.5 10.5h4v4h-4z")],
  properties: [S("M2.5 4.5h11M2.5 8h11M2.5 11.5h11"), F("M5.5 6a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM10.5 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM6.5 13a1.5 1.5 0 100-3 1.5 1.5 0 000 3z")],
  layers: [S("M8 2.5l6 3.2-6 3.2-6-3.2z"), S("M2 8.8l6 3.2 6-3.2M2 11.5l6 3 6-3")],
  channels: [S("M6 11a4 4 0 100-8 4 4 0 000 8z"), S("M10 11a4 4 0 100-8 4 4 0 000 8z", { o: 0.75 }), S("M8 13.5a4 4 0 100-8 4 4 0 000 8z", { o: 0.5 })],
  paths: [S("M3 13c0-6 4-9 10-10"), F("M3 14.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM13 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"), S("M8.5 4.6l2.4 4.1", { o: 0.6 })],
  history: [S("M3 7.8a5 5 0 019.2-2.2"), S("M12.8 2.8v2.8H10"), S("M13 8.4a5 5 0 01-9.6 2"), S("M8 5.5V8l2 1.2")],
  ai: [S("M8 1.8l1.5 4.2 4.2 1.5-4.2 1.5L8 13.2 6.5 9 2.3 7.5 6.5 6z"), S("M12.6 11.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z", { w: 1 })],
  "ai-history": [S("M3 7.8a5 5 0 019.2-2.2"), S("M12.8 2.8v2.8H10"), S("M13 8.4a5 5 0 01-9.6 2"), S("M8 5.4l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z", { w: 1 })],
  navigator: [S("M2.5 2.5h11v11h-11z"), S("M5.5 5.5h5v4h-5z", { w: 1.5 })],
};

/** Legacy / alternate ids → canonical glyph names. */
export const ICON_ALIASES: Record<string, string> = {
  text: "type-h",
  type: "type-h",
  "marquee-ellipse-tool": "marquee-ellipse",
  "polygon-lasso": "lasso-polygon",
  "magic-wand": "wand",
  "paint-bucket": "bucket",
  "clone-stamp": "clone",
  visibility: "eye",
  "visibility-off": "eye-off",
  "adjustment-layer": "adjustment",
  "layer-mask": "mask",
  "new-page": "new-layer",
  delete: "trash",
  menu: "panel-menu",
  camera: "snapshot",
  grid: "lock-transparent",
  hand: "hand",
};

export function resolveIcon(name: string): IconDef | undefined {
  return ICONS[name] ?? ICONS[ICON_ALIASES[name] ?? ""];
}

export function hasIcon(name: string): boolean {
  return resolveIcon(name) !== undefined;
}

export const ICON_NAMES: readonly string[] = Object.keys(ICONS);
