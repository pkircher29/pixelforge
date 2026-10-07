import { describe, expect, it } from "vitest";
import { colorReadout, cursorReadout, docSizeLine, formatUnitValue, measureReadout, pxToUnit, sizeReadout } from "../../lib/ui/panels/info-model";

describe("info readouts", () => {
  it("gives RGB / CMYK / HSB / gray / web readouts, blank when off-canvas", () => {
    const c = { r: 255, g: 0, b: 0, a: 255 };
    expect(colorReadout("rgb", c)).toEqual([{ k: "R", v: "255" }, { k: "G", v: "0" }, { k: "B", v: "0" }]);
    expect(colorReadout("cmyk", c).map((l) => l.v)).toEqual(["0%", "100%", "100%", "0%"]);
    expect(colorReadout("hsb", c).map((l) => l.v)).toEqual(["0°", "100%", "100%"]);
    expect(colorReadout("gray", { r: 0, g: 0, b: 0, a: 255 })).toEqual([{ k: "K", v: "100%" }]);
    expect(colorReadout("web", c)).toEqual([{ k: "#", v: "FF0000" }]);
    expect(colorReadout("cmyk", null).every((l) => l.v === "")).toBe(true);
  });

  it("converts pixels to ruler units", () => {
    expect(pxToUnit(144, "in", 72, 1000)).toBe(2);
    expect(pxToUnit(300, "cm", 300, 1000)).toBeCloseTo(2.54);
    expect(pxToUnit(300, "mm", 300, 1000)).toBeCloseTo(25.4);
    expect(pxToUnit(250, "%", 72, 1000)).toBe(25);
    expect(formatUnitValue(1.234, "in")).toBe("1.23");
    expect(formatUnitValue(12.34, "mm")).toBe("12.3");
    expect(formatUnitValue(12.6, "px")).toBe("13");
  });

  it("reads the cursor position in the current unit", () => {
    expect(cursorReadout({ x: 72, y: 36 }, "in", 72, 500, 500)).toEqual([{ k: "X", v: "1.00" }, { k: "Y", v: "0.50" }]);
    expect(cursorReadout(null, "px", 72, 500, 500)).toEqual([{ k: "X", v: "" }, { k: "Y", v: "" }]);
  });

  it("shows selection W/H, and W/H/A while transforming", () => {
    expect(sizeReadout({ kind: "selection", w: 120, h: 80 }, "px", 72, 500, 500)).toEqual([{ k: "W", v: "120" }, { k: "H", v: "80" }]);
    const t = sizeReadout({ kind: "transform", w: 100, h: 50, angle: 12.34 }, "px", 72, 500, 500);
    expect(t.at(-1)).toEqual({ k: "A", v: "12.3°" });
    expect(sizeReadout(null, "px", 72, 1, 1).every((l) => l.v === "")).toBe(true);
  });

  it("formats the ruler-tool measure and the document size line", () => {
    const m = measureReadout({ length: 100, angle: 45, dx: 70.7, dy: 70.7 }, "px", 72, 500, 500);
    expect(m.map((l) => l.k)).toEqual(["A", "L", "ΔX", "ΔY"]);
    expect(m[0]!.v).toBe("45.0°");
    expect(measureReadout(null, "px", 72, 1, 1)).toEqual([]);
    expect(docSizeLine(1920 * 1080 * 4, 2 * 1920 * 1080 * 4)).toBe("Doc: 7.91M/15.82M");
  });
});
