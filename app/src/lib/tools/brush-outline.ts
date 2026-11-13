import { renderDabMask } from "./brush-engine";
import type { BrushTip } from "./brush-tips";

export type OutlineSegment = readonly [number, number, number, number];

/** Marching squares on pixel centres, padded with transparent samples at the border. */
export function alphaOutline(alpha: Float32Array, width: number, height: number, threshold = 0.5): OutlineSegment[] {
  const result: OutlineSegment[] = [];
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[y * width + x]!;
  for (let y = -1; y < height; y++) for (let x = -1; x < width; x++) {
    const values = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
    const points = [[x + 0.5, y + 0.5], [x + 1.5, y + 0.5], [x + 1.5, y + 1.5], [x + 0.5, y + 1.5]];
    const crossings: number[][] = [];
    for (let edge = 0; edge < 4; edge++) {
      const next = (edge + 1) % 4;
      const a = values[edge]!, b = values[next]!;
      if ((a >= threshold) === (b >= threshold)) continue;
      const t = (threshold - a) / (b - a);
      crossings.push([points[edge]![0]! + t * (points[next]![0]! - points[edge]![0]!), points[edge]![1]! + t * (points[next]![1]! - points[edge]![1]!)]);
    }
    const add = (a: number[], b: number[]) => result.push([a[0]! - width / 2, a[1]! - height / 2, b[0]! - width / 2, b[1]! - height / 2]);
    if (crossings.length === 2) add(crossings[0]!, crossings[1]!);
    else if (crossings.length === 4) {
      // Resolve diagonal saddles using the centre sample, retaining holes and islands.
      const centreInside = values.reduce((a, b) => a + b, 0) / 4 >= threshold;
      if ((values[0]! >= threshold) === centreInside) {
        add(crossings[0]!, crossings[1]!); add(crossings[2]!, crossings[3]!);
      } else {
        add(crossings[0]!, crossings[3]!); add(crossings[1]!, crossings[2]!);
      }
    }
  }
  return result;
}

const cache = new WeakMap<BrushTip, Map<string, OutlineSegment[]>>();

/** Bounded per-tip cache. Use the paint engine's transforms so the cursor matches the dab. */
export function brushOutline(tip: BrushTip, size: number, angle: number, roundness: number, flipX = false, flipY = false): OutlineSegment[] {
  if (!tip.raster || !Number.isFinite(size) || size <= 0) return [];
  let entries = cache.get(tip);
  if (!entries) { entries = new Map(); cache.set(tip, entries); }
  const key = `${size}|${angle}|${roundness}|${flipX}|${flipY}`;
  const hit = entries.get(key);
  if (hit) return hit;
  // Bound work at high zoom; subpixel interpolation preserves the contour when enlarged.
  const sampleSize = Math.min(256, size);
  const mask = renderDabMask(tip, sampleSize, angle, roundness, 1, { flipX, flipY });
  const scale = size / sampleSize;
  let peak = 0;
  for (const a of mask.cov) peak = Math.max(peak, a);
  const outline = peak === 0 ? [] : alphaOutline(mask.cov, mask.n, mask.n, peak * 0.5)
    .map(([x, y, x2, y2]): OutlineSegment => [x * scale, y * scale, x2 * scale, y2 * scale]);
  if (entries.size >= 32) entries.delete(entries.keys().next().value!);
  entries.set(key, outline);
  return outline;
}
