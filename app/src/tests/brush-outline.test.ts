import { describe, expect, it } from "vitest";
import { alphaOutline, brushOutline, type OutlineSegment } from "../lib/tools/brush-outline";
import { tipById } from "../lib/tools/brush-tips";

function bounds(lines: OutlineSegment[]) {
  const x = lines.flatMap(s => [s[0], s[2]]), y = lines.flatMap(s => [s[1], s[3]]);
  return { width: Math.max(...x) - Math.min(...x), height: Math.max(...y) - Math.min(...y) };
}

describe("brush cursor contours", () => {
  it("closes contours at image edges and leaves empty masks empty", () => {
    expect(alphaOutline(new Float32Array(4), 2, 2)).toEqual([]);
    const outline = alphaOutline(new Float32Array(4).fill(1), 2, 2);
    expect(bounds(outline)).toEqual({ width: 2, height: 2 });
    const vertices = new Map<string, number>();
    for (const [x, y, x2, y2] of outline) for (const key of [`${x},${y}`, `${x2},${y2}`]) vertices.set(key, (vertices.get(key) ?? 0) + 1);
    expect([...vertices.values()].every(n => n === 2)).toBe(true);
  });

  it("keeps holes and separated islands rather than outlining their bounding box", () => {
    const ring = new Float32Array(25).fill(1); ring[12] = 0;
    const outline = alphaOutline(ring, 5, 5);
    expect(outline.filter(s => s.every(v => Math.abs(v) <= 0.5))).toHaveLength(4);
    const islands = new Float32Array([1, 0, 0, 0, 1]);
    expect(alphaOutline(islands, 5, 1)).toHaveLength(8);
  });

  it("follows custom tip roundness and rotation and reuses cached paths", () => {
    const tip = tipById("triangle");
    const horizontal = brushOutline(tip, 100, 0, 0.25);
    const rotated = brushOutline(tip, 100, 90, 0.25);
    expect(horizontal.length).toBeGreaterThan(10);
    const a = bounds(horizontal), b = bounds(rotated);
    expect(a.width).toBeGreaterThan(a.height * 2);
    expect(b.height).toBeCloseTo(a.width, 4);
    expect(b.width).toBeCloseTo(a.height, 4);
    expect(brushOutline(tip, 100, 0, 0.25)).toBe(horizontal);
    expect(brushOutline(tip, 100, 0, 0.25, true)).not.toBe(horizontal);
  });

  it("bounds work for large cursors and scales the resulting geometry", () => {
    const tip = tipById("triangle");
    const normal = brushOutline(tip, 256, 20, 0.8);
    const huge = brushOutline(tip, 4096, 20, 0.8);
    expect(huge.length).toBe(normal.length);
    expect(bounds(huge).width).toBeCloseTo(bounds(normal).width * 16, 4);
  });
});
