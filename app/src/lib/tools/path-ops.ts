/**
 * Stroke Path with a tool (brush engine dabs along the flattened path) and Fill Path with
 * contents / opacity / feather, onto a paint target. Pure enough to unit-test with a
 * raster target.
 */
import { flattenPath, pathToSelection, type Path, type Raster, type RGBA, type Selection } from "$lib/engine";
import { BrushStroke, type BrushSettings, type StrokeBlend } from "./brush-engine";

/** Stroke every subpath of `path` (doc space) into `raster` at `offset` with brush `settings`. */
export function strokePathWithBrush(raster: Raster, offset: { x: number; y: number }, path: Path, settings: BrushSettings, blend: StrokeBlend, opts: { opacity?: number; flow?: number; selection?: Selection | null; simulatePressure?: boolean; seed?: number } = {}): BrushStroke | null {
  let last: BrushStroke | null = null;
  const before = raster.clone();
  for (const sp of flattenPath(path, 0.25)) {
    const pts = sp.points.slice();
    if (sp.closed && pts.length > 1) pts.push(pts[0]!);
    if (pts.length === 0) continue;
    const stroke = new BrushStroke(raster, {
      settings: { ...settings, smoothing: 0 },
      blend,
      opacity: opts.opacity ?? 1,
      flow: opts.flow ?? 1,
      selection: opts.selection ?? null,
      offset,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    const n = pts.length;
    pts.forEach((p, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const pressure = opts.simulatePressure ? Math.sin(t * Math.PI) : 1;
      stroke.moveTo({ x: p.x - offset.x, y: p.y - offset.y }, opts.simulatePressure ? { pressure: Math.max(0.05, pressure), pointerType: "pen" } : {});
    });
    last = stroke;
  }
  void before;
  return last;
}

export type FillContents = "fg" | "bg" | "black" | "white" | "gray" | "pattern";

export function fillColorFor(contents: FillContents, fg: RGBA, bg: RGBA): RGBA {
  switch (contents) {
    case "fg":
      return fg;
    case "bg":
      return bg;
    case "black":
      return { r: 0, g: 0, b: 0, a: 255 };
    case "white":
      return { r: 255, g: 255, b: 255, a: 255 };
    default:
      return { r: 128, g: 128, b: 128, a: 255 };
  }
}

/** Fill `path` into `raster` (offset) with a color or pattern, opacity, feather radius. Returns the coverage selection used. */
export function fillPathInto(
  raster: Raster,
  offset: { x: number; y: number },
  path: Path,
  docW: number,
  docH: number,
  source: { color: RGBA } | { pattern: Raster },
  opts: { opacity?: number; feather?: number; antialias?: boolean; clip?: Selection | null } = {},
): Selection {
  let sel = pathToSelection(path, docW, docH, { aa: opts.antialias ?? true, feather: opts.feather ?? 0 });
  if (opts.clip && !opts.clip.isEmpty) sel = sel.intersect(opts.clip);
  const op = opts.opacity ?? 1;
  const d = raster.data;
  const w = raster.width;
  const px = { r: 0, g: 0, b: 0, a: 0 };
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < w; x++) {
      const m = sel.get(x + offset.x, y + offset.y);
      if (!m) continue;
      let r: number, g: number, b: number, a: number;
      if ("color" in source) {
        r = source.color.r;
        g = source.color.g;
        b = source.color.b;
        a = source.color.a / 255;
      } else {
        const pw = source.pattern.width;
        const ph = source.pattern.height;
        source.pattern.getPixel((((x + offset.x) % pw) + pw) % pw, (((y + offset.y) % ph) + ph) % ph, px);
        r = px.r;
        g = px.g;
        b = px.b;
        a = px.a / 255;
      }
      const sa = (m / 255) * op * a;
      if (sa <= 0) continue;
      const p = (y * w + x) * 4;
      const ba = d[p + 3]! / 255;
      const ao = sa + ba * (1 - sa);
      const ws = sa / ao;
      const wd = (ba * (1 - sa)) / ao;
      d[p] = r * ws + d[p]! * wd;
      d[p + 1] = g * ws + d[p + 1]! * wd;
      d[p + 2] = b * ws + d[p + 2]! * wd;
      d[p + 3] = ao * 255;
    }
  }
  return sel;
}
