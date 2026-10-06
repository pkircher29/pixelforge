import { describe, expect, it } from "vitest";
import { fitRect } from "../lib/ui/canvas/fit";
import { CHECKER_FRAG, CHECKER_VERT, DEFAULT_COLORS } from "../lib/ui/canvas/checkerboard";

describe("fitRect", () => {
  it("scales up and centres a small document", () => {
    const r = fitRect(1000, 500, 2000, 2000, 0);
    expect(r.zoom).toBe(2);
    expect(r).toMatchObject({ x: 0, y: 500, w: 2000, h: 1000 });
  });

  it("scales down with padding and keeps aspect", () => {
    const r = fitRect(4000, 4000, 1000, 1000, 100);
    expect(r.zoom).toBeCloseTo(0.2);
    expect(r).toMatchObject({ x: 100, y: 100, w: 800, h: 800 });
  });

  it("never produces a degenerate rect", () => {
    const r = fitRect(0, 0, 10, 10, 50);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.zoom)).toBe(true);
  });
});

describe("checkerboard shaders", () => {
  it("are GLSL ES 3.00 sources with the expected uniforms", () => {
    expect(CHECKER_VERT.trimStart().startsWith("#version 300 es")).toBe(true);
    expect(CHECKER_FRAG.trimStart().startsWith("#version 300 es")).toBe(true);
    for (const name of ["u_viewport", "u_rect", "u_cell", "u_light", "u_dark", "u_bg", "u_glow"]) {
      expect(CHECKER_FRAG).toContain(`uniform`);
      expect(CHECKER_FRAG).toContain(name);
    }
    expect(DEFAULT_COLORS.light.every((c) => c >= 0 && c <= 1)).toBe(true);
  });
});
