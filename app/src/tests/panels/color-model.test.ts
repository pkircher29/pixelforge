import { describe, expect, it } from "vitest";
import {
  cmykToRgb,
  cubeColor,
  cubePosition,
  grayKToRgb,
  hexToRgb,
  hsbToRgb,
  isWebSafe,
  rampColor,
  rgbToCmyk,
  rgbToGrayK,
  rgbToHex,
  rgbToHsb,
  snapWebSafe,
  type CubeMode,
} from "../../lib/ui/panels/color-model";

describe("color model", () => {
  it("converts RGB ↔ HSB for primaries, grays and an arbitrary colour", () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, b: 100 });
    expect(rgbToHsb({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, b: 100 });
    expect(rgbToHsb({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, b: 100 });
    expect(rgbToHsb({ r: 128, g: 128, b: 128 })).toMatchObject({ s: 0, b: 50.2 });
    expect(hsbToRgb({ h: 60, s: 100, b: 100 })).toEqual({ r: 255, g: 255, b: 0 });
    expect(hsbToRgb({ h: 0, s: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("round-trips RGB → HSB → RGB within one level for a sweep of colours", () => {
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 85)
        for (let b = 0; b <= 255; b += 64) {
          const back = hsbToRgb(rgbToHsb({ r, g, b }));
          expect(Math.abs(back.r - r) + Math.abs(back.g - g) + Math.abs(back.b - b)).toBeLessThanOrEqual(3);
        }
  });

  it("formats and parses hex (#rgb, #rrggbb, no #, bad input)", () => {
    expect(rgbToHex({ r: 18, g: 52, b: 255 })).toBe("#1234ff");
    expect(hexToRgb("#1234FF")).toEqual({ r: 18, g: 52, b: 255 });
    expect(hexToRgb("abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb(" 00ff00 ")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("zzzzzz")).toBeNull();
  });

  it("snaps to the 216 web-safe colours", () => {
    expect(snapWebSafe({ r: 30, g: 140, b: 250 })).toEqual({ r: 51, g: 153, b: 255 });
    expect(snapWebSafe({ r: 25, g: 26, b: 0 })).toEqual({ r: 0, g: 51, b: 0 });
    expect(isWebSafe({ r: 51, g: 102, b: 204 })).toBe(true);
    expect(isWebSafe({ r: 50, g: 102, b: 204 })).toBe(false);
  });

  it("approximates CMYK like PS's unmanaged readout", () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(cmykToRgb({ c: 0, m: 100, y: 100, k: 0 })).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("maps grayscale K% both ways", () => {
    expect(rgbToGrayK({ r: 255, g: 255, b: 255 })).toBe(0);
    expect(rgbToGrayK({ r: 0, g: 0, b: 0 })).toBe(100);
    expect(grayKToRgb(50)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("cube position ↔ colour is consistent in all six modes", () => {
    const modes: CubeMode[] = ["H", "S", "B", "R", "G", "BL"];
    const c = { r: 200, g: 80, b: 40 };
    for (const m of modes) {
      const back = cubeColor(m, cubePosition(m, c));
      expect(Math.abs(back.r - c.r) + Math.abs(back.g - c.g) + Math.abs(back.b - c.b), m).toBeLessThanOrEqual(3);
    }
  });

  it("Hue Cube geometry: strip top is red, square top-right is the pure hue, bottom is black", () => {
    expect(cubeColor("H", { v: 1, u: 1, w: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(cubeColor("H", { v: 0.5, u: 1, w: 1 })).toEqual({ r: 0, g: 255, b: 255 });
    expect(cubeColor("H", { v: 0.3, u: 0.7, w: 0 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(cubeColor("H", { v: 0.3, u: 0, w: 1 })).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("the spectrum ramp has white and black at its ends", () => {
    expect(rampColor(0)).toEqual({ r: 255, g: 255, b: 255 });
    expect(rampColor(1)).toEqual({ r: 0, g: 0, b: 0 });
    expect(rampColor(0.04 + 0.92 / 3)).toEqual({ r: 0, g: 255, b: 0 });
  });
});
