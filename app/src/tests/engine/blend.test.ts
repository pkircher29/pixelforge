import { describe, expect, it } from "vitest";
import {
  BLEND_MODES,
  BLEND_MODE_INDEX,
  BLEND_GLSL,
  BlendMode,
  blendChannel,
  blendRgb,
  compositeStraight,
  isSeparable,
  isBlendMode,
} from "../../lib/engine";

const out = new Float32Array(4);

function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

describe("blend mode table", () => {
  it("has exactly the 16 PLAN.md modes with stable indices and GLSL bodies", () => {
    expect(BLEND_MODES).toHaveLength(16);
    expect(new Set(BLEND_MODES).size).toBe(16);
    BLEND_MODES.forEach((m, i) => {
      expect(BLEND_MODE_INDEX[m]).toBe(i);
      expect(BLEND_GLSL[m]).toContain("return");
    });
    expect(isSeparable(BlendMode.Exclusion)).toBe(true);
    expect(isSeparable(BlendMode.Hue)).toBe(false);
    expect(isBlendMode("multiply")).toBe(true);
    expect(isBlendMode("plus-lighter")).toBe(false);
  });
});

describe("separable blend math", () => {
  it("multiply 50% gray x 50% gray = 25%", () => {
    expect(blendChannel(BlendMode.Multiply, 0.5, 0.5)).toBeCloseTo(0.25, 6);
    compositeStraight(BlendMode.Multiply, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, out);
    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(out[3]).toBe(1);
  });

  it("screen, darken, lighten, difference, exclusion", () => {
    expect(blendChannel(BlendMode.Screen, 0.5, 0.5)).toBeCloseTo(0.75, 6);
    expect(blendChannel(BlendMode.Darken, 0.3, 0.7)).toBe(0.3);
    expect(blendChannel(BlendMode.Lighten, 0.3, 0.7)).toBe(0.7);
    expect(blendChannel(BlendMode.Difference, 0.75, 0.25)).toBeCloseTo(0.5, 6);
    expect(blendChannel(BlendMode.Exclusion, 0.5, 0.5)).toBeCloseTo(0.5, 6);
    expect(blendChannel(BlendMode.Normal, 0.2, 0.9)).toBe(0.9);
  });

  it("overlay(cb, cs) equals hardLight(cs, cb)", () => {
    for (const [cb, cs] of [
      [0.25, 0.5],
      [0.8, 0.3],
      [0.5, 0.5],
      [0.1, 0.9],
    ] as const) {
      expect(blendChannel(BlendMode.Overlay, cb, cs)).toBeCloseTo(blendChannel(BlendMode.HardLight, cs, cb), 6);
    }
    expect(blendChannel(BlendMode.Overlay, 0.25, 0.5)).toBeCloseTo(0.25, 6);
    expect(blendChannel(BlendMode.HardLight, 0.5, 0.75)).toBeCloseTo(0.75, 6);
  });

  it("color dodge / burn edge cases match the spec", () => {
    expect(blendChannel(BlendMode.ColorDodge, 0, 0.9)).toBe(0);
    expect(blendChannel(BlendMode.ColorDodge, 0.3, 1)).toBe(1);
    expect(blendChannel(BlendMode.ColorDodge, 0.5, 0.5)).toBe(1);
    expect(blendChannel(BlendMode.ColorDodge, 0.25, 0.5)).toBeCloseTo(0.5, 6);
    expect(blendChannel(BlendMode.ColorBurn, 1, 0.1)).toBe(1);
    expect(blendChannel(BlendMode.ColorBurn, 0.5, 0)).toBe(0);
    expect(blendChannel(BlendMode.ColorBurn, 0.5, 0.5)).toBe(0);
    expect(blendChannel(BlendMode.ColorBurn, 0.75, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("soft light: 50% source is identity; both D(cb) branches", () => {
    for (const cb of [0, 0.2, 0.5, 0.9]) expect(blendChannel(BlendMode.SoftLight, cb, 0.5)).toBeCloseTo(cb, 6);
    expect(blendChannel(BlendMode.SoftLight, 0.25, 1)).toBeCloseTo(0.5, 6);
    expect(blendChannel(BlendMode.SoftLight, 0.64, 1)).toBeCloseTo(0.8, 6);
    expect(blendChannel(BlendMode.SoftLight, 0.5, 0)).toBeCloseTo(0.25, 6);
  });

  it("throws for non-separable modes via blendChannel", () => {
    expect(() => blendChannel(BlendMode.Hue, 0.5, 0.5)).toThrow();
  });
});

describe("non-separable blend math (Photoshop / W3C)", () => {
  it("luminosity takes the source luminance (white over red = white)", () => {
    const o = new Float32Array(3);
    blendRgb(BlendMode.Luminosity, 1, 0, 0, 1, 1, 1, o);
    expect(o[0]).toBeCloseTo(1, 5);
    expect(o[1]).toBeCloseTo(1, 5);
    expect(o[2]).toBeCloseTo(1, 5);
  });

  it("color keeps the backdrop luminance", () => {
    const o = new Float32Array(3);
    blendRgb(BlendMode.Color, 0.5, 0.5, 0.5, 1, 0, 0, o);
    expect(lum(o[0]!, o[1]!, o[2]!)).toBeCloseTo(0.5, 5);
    expect(o[0]).toBeGreaterThan(o[1]!);
  });

  it("hue over a gray backdrop stays gray; saturation of a gray source desaturates", () => {
    const o = new Float32Array(3);
    blendRgb(BlendMode.Hue, 0.5, 0.5, 0.5, 0, 1, 0, o);
    expect(o[0]).toBeCloseTo(0.5, 5);
    expect(o[1]).toBeCloseTo(0.5, 5);
    expect(o[2]).toBeCloseTo(0.5, 5);
    blendRgb(BlendMode.Saturation, 1, 0, 0, 0.4, 0.4, 0.4, o);
    expect(o[0]).toBeCloseTo(0.3, 5);
    expect(o[1]).toBeCloseTo(0.3, 5);
    expect(o[2]).toBeCloseTo(0.3, 5);
  });
});

describe("compositeStraight (W3C general formula)", () => {
  it("source alpha 0 leaves the backdrop; backdrop alpha 0 yields the source", () => {
    compositeStraight(BlendMode.Multiply, 0.2, 0.4, 0.6, 0.8, 0.9, 0.9, 0.9, 0, out);
    expect(Array.from(out)).toEqual([expect.closeTo(0.2, 5), expect.closeTo(0.4, 5), expect.closeTo(0.6, 5), expect.closeTo(0.8, 5)]);
    compositeStraight(BlendMode.Multiply, 0.2, 0.4, 0.6, 0, 0.9, 0.8, 0.7, 0.5, out);
    expect(out[0]).toBeCloseTo(0.9, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
    expect(out[3]).toBeCloseTo(0.5, 5);
  });

  it("normal at 50% over opaque is a plain lerp", () => {
    compositeStraight(BlendMode.Normal, 0, 0, 0, 1, 1, 1, 1, 0.5, out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[3]).toBe(1);
  });

  it("both transparent yields transparent", () => {
    compositeStraight(BlendMode.Screen, 1, 1, 1, 0, 1, 1, 1, 0, out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
});
