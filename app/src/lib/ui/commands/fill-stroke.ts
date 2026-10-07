/**
 * Edit ▸ Fill… / Stroke… option plumbing and pixel kernels (pure; no stores). The
 * dialogs collect `FillOptions` / `StrokeOptions`; `edit.ts` resolves the target layer
 * and wraps the result in a `PaintCommand`. Tested in `tests/panels/fill-stroke.test.ts`.
 */
import { BlendMode, Rect, Raster, compositeStraight, dilateCoverage, erodeCoverage, type Point, type RGBA } from "$lib/engine";

export type FillContents = "foreground" | "background" | "color" | "pattern" | "history" | "black" | "gray" | "white";

export const FILL_CONTENTS: readonly { id: FillContents; label: string }[] = [
  { id: "foreground", label: "Foreground Color" },
  { id: "background", label: "Background Color" },
  { id: "color", label: "Color…" },
  { id: "pattern", label: "Pattern" },
  { id: "history", label: "History" },
  { id: "black", label: "Black" },
  { id: "gray", label: "50% Gray" },
  { id: "white", label: "White" },
];

export interface FillOptions {
  contents: FillContents;
  /** Used by `contents: "color"`. */
  color: RGBA;
  /** Used by `contents: "pattern"`. */
  patternId: string;
  mode: BlendMode;
  /** 0..100 */
  opacity: number;
  preserveTransparency: boolean;
}

export const DEFAULT_FILL: FillOptions = {
  contents: "foreground",
  color: { r: 0, g: 0, b: 0, a: 255 },
  patternId: "checker",
  mode: BlendMode.Normal,
  opacity: 100,
  preserveTransparency: false,
};

export type StrokeLocation = "inside" | "center" | "outside";

export interface StrokeOptions {
  /** px, 1..250 (PS limit). */
  width: number;
  color: RGBA;
  location: StrokeLocation;
  mode: BlendMode;
  /** 0..100 */
  opacity: number;
  preserveTransparency: boolean;
}

export const DEFAULT_STROKE: StrokeOptions = {
  width: 1,
  color: { r: 0, g: 0, b: 0, a: 255 },
  location: "center",
  mode: BlendMode.Normal,
  opacity: 100,
  preserveTransparency: false,
};

/** Clamp / repair dialog output (also used for remembered options). */
export function normalizeFill(o: Partial<FillOptions>): FillOptions {
  const f = { ...DEFAULT_FILL, ...o };
  f.opacity = clampNum(f.opacity, 0, 100, 100);
  if (!FILL_CONTENTS.some((c) => c.id === f.contents)) f.contents = "foreground";
  return f;
}

export function normalizeStroke(o: Partial<StrokeOptions>): StrokeOptions {
  const s = { ...DEFAULT_STROKE, ...o };
  s.width = Math.round(clampNum(s.width, 1, 250, 1));
  s.opacity = clampNum(s.opacity, 0, 100, 100);
  if (s.location !== "inside" && s.location !== "outside") s.location = "center";
  return s;
}

function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** Solid color for the solid contents kinds, or null for pattern / history. */
export function fillSolidColor(contents: FillContents, fg: RGBA, bg: RGBA, color: RGBA): RGBA | null {
  switch (contents) {
    case "foreground":
      return { ...fg, a: 255 };
    case "background":
      return { ...bg, a: 255 };
    case "color":
      return { ...color, a: 255 };
    case "black":
      return { r: 0, g: 0, b: 0, a: 255 };
    case "gray":
      return { r: 128, g: 128, b: 128, a: 255 };
    case "white":
      return { r: 255, g: 255, b: 255, a: 255 };
    default:
      return null;
  }
}

/** History label PS uses ("Fill", "Stroke"). */
export function fillLabel(o: FillOptions): string {
  return o.contents === "history" ? "Fill (History)" : o.contents === "pattern" ? "Fill (Pattern)" : "Fill";
}

/** Doc-space pattern lookup (tiled from the document origin). */
export function patternSource(p: Raster): (docX: number, docY: number) => RGBA {
  const w = p.width;
  const h = p.height;
  const out: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  return (x, y) => p.getPixel(((x % w) + w) % w, ((y % h) + h) % h, out);
}

/**
 * Composite a source over `target` (raster space, layer at `offset`) inside `area`
 * (raster space), weighted by `coverage(docX, docY)` 0..1. `source(docX, docY)` gives the
 * fill color. Blend `mode` and `opacity` 0..1; `preserve` keeps each pixel's alpha (PS
 * "Preserve Transparency": empty pixels stay empty). Returns the touched rect or null.
 */
export function fillPixels(
  target: Raster,
  offset: Point,
  area: Rect,
  coverage: (docX: number, docY: number) => number,
  source: (docX: number, docY: number) => RGBA,
  opts: { mode: BlendMode; opacity: number; preserve: boolean },
): Rect | null {
  const a = Rect.intersect(area, target.bounds());
  if (Rect.isEmpty(a)) return null;
  const d = target.data;
  const W = target.width;
  const out = new Float32Array(4);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = a.y; y < a.y + a.h; y++) {
    for (let x = a.x; x < a.x + a.w; x++) {
      const dx = x + offset.x;
      const dy = y + offset.y;
      const cov = coverage(dx, dy);
      if (cov <= 0) continue;
      const p = (y * W + x) * 4;
      const ab = d[p + 3]! / 255;
      if (opts.preserve && ab === 0) continue;
      const s = source(dx, dy);
      const as = (s.a / 255) * cov * opts.opacity;
      if (as <= 0) continue;
      compositeStraight(opts.mode, d[p]! / 255, d[p + 1]! / 255, d[p + 2]! / 255, ab, s.r / 255, s.g / 255, s.b / 255, as, out);
      d[p] = out[0]! * 255;
      d[p + 1] = out[1]! * 255;
      d[p + 2] = out[2]! * 255;
      d[p + 3] = (opts.preserve ? ab : out[3]!) * 255;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? null : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/**
 * The stroke band of a selection (doc space): `mask` is `w × h` coverage 0..255; returns
 * a float coverage over `rect` (the selection bbox grown by the width) so callers look
 * up `band[(y - rect.y) * rect.w + (x - rect.x)]`.
 */
export function strokeBand(mask: Uint8Array, w: number, h: number, bbox: Rect, width: number, location: StrokeLocation): { rect: Rect; band: Float32Array } {
  const grow = Math.ceil(width) + 2;
  const rect = Rect.intersect(Rect.inflate(bbox, grow), Rect.ofSize(w, h));
  const cov = new Float32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) cov[y * rect.w + x] = mask[(y + rect.y) * w + x + rect.x]! / 255;
  let band: Float32Array;
  if (location === "inside") {
    const er = erodeCoverage(cov, rect.w, rect.h, width);
    band = cov.map((c, i) => Math.max(0, c - er[i]!));
  } else if (location === "outside") {
    const di = dilateCoverage(cov, rect.w, rect.h, width);
    band = di.map((c, i) => Math.max(0, c - cov[i]!));
  } else {
    const di = dilateCoverage(cov, rect.w, rect.h, width / 2);
    const er = erodeCoverage(cov, rect.w, rect.h, width / 2);
    band = di.map((c, i) => Math.max(0, c - er[i]!));
  }
  return { rect, band };
}

// ---------------------------------------------------------------------------- user patterns

export interface UserPattern {
  id: string;
  name: string;
  raster: Raster;
}

const userPatterns: UserPattern[] = [];

/** Edit ▸ Define Pattern… (session-only: patterns are kept until the app closes). */
export function definePattern(name: string, raster: Raster): UserPattern {
  const p: UserPattern = { id: `user-pattern-${userPatterns.length + 1}-${Date.now().toString(36)}`, name, raster };
  userPatterns.push(p);
  return p;
}

export function getUserPatterns(): readonly UserPattern[] {
  return userPatterns;
}
