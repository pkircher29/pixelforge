import { describe, expect, it } from "vitest";
import { largestInscribedRect } from "../../lib/tools/crop";

describe("Straighten crop box (largest inscribed rect)", () => {
  it("is the whole image when not rotated", () => {
    const r = largestInscribedRect(1920, 1080, 0);
    expect(r.w).toBeCloseTo(1920, 6);
    expect(r.h).toBeCloseTo(1080, 6);
  });

  it("shrinks for a small tilt and fits inside the rotated image", () => {
    const a = (2.29 * Math.PI) / 180;
    const r = largestInscribedRect(1920, 1080, a);
    expect(r.w).toBeLessThan(1920);
    expect(r.h).toBeLessThan(1080);
    expect(r.w).toBeGreaterThan(1800);
    // Corners of the inner rect, rotated back, stay inside the original image.
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    for (const [x, y] of [[-r.w / 2, -r.h / 2], [r.w / 2, -r.h / 2], [r.w / 2, r.h / 2], [-r.w / 2, r.h / 2]] as const) {
      const rx = x * c - y * s;
      const ry = x * s + y * c;
      expect(Math.abs(rx)).toBeLessThanOrEqual(960 + 1e-6);
      expect(Math.abs(ry)).toBeLessThanOrEqual(540 + 1e-6);
    }
  });
});
