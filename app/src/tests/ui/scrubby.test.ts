import { describe, expect, it } from "vitest";
import { scrubValue, parseTyped, toSlider, fromSlider, nudge, formatNumber, clampStep } from "../../lib/ui/controls/scrubby";

const pct = { min: 0, max: 100, step: 1 };
const size = { min: 1, max: 500, step: 1, log: true };

describe("scrubby number math", () => {
  it("drags 1 px = 1 step, Shift ×10, Alt ÷10, clamped", () => {
    expect(scrubValue(50, 7, pct)).toBe(57);
    expect(scrubValue(50, -7, pct)).toBe(43);
    expect(scrubValue(50, 7, pct, { shift: true })).toBe(100);
    expect(scrubValue(50, 30, pct, { alt: true })).toBe(53);
    expect(scrubValue(50, -900, pct)).toBe(0);
  });

  it("log fields scale proportionally and never drop below min", () => {
    const up = scrubValue(100, 69, size);
    expect(up).toBeGreaterThan(190);
    expect(up).toBeLessThan(210);
    expect(scrubValue(100, -69, size)).toBeCloseTo(50, -1);
    expect(scrubValue(1, -500, size)).toBe(1);
    expect(scrubValue(400, 400, size)).toBe(500);
  });

  it("snaps to step and keeps the field free of float noise", () => {
    expect(clampStep(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(clampStep(7, { min: 0, max: 100, step: 5 })).toBe(5);
    expect(clampStep(8, { min: 0, max: 100, step: 5 })).toBe(10);
  });

  it("parses typed values with units and relative +N", () => {
    expect(parseTyped("50%", 10, pct)).toBe(50);
    expect(parseTyped(" 12 px", 10, size)).toBe(12);
    expect(parseTyped("+5", 10, pct)).toBe(15);
    expect(parseTyped("-5", 10, pct)).toBe(0);
    expect(parseTyped("abc", 10, pct)).toBeNull();
    expect(parseTyped("", 10, pct)).toBeNull();
    expect(parseTyped("999", 10, pct)).toBe(100);
  });

  it("slider ↔ value round-trips linearly and logarithmically", () => {
    expect(toSlider(50, pct)).toBe(500);
    expect(fromSlider(500, pct)).toBe(50);
    expect(fromSlider(toSlider(24, size), size)).toBe(24);
    expect(toSlider(1, size)).toBe(0);
    expect(toSlider(500, size)).toBe(1000);
  });

  it("nudges with arrows and formats compactly", () => {
    expect(nudge(10, 1, pct)).toBe(11);
    expect(nudge(10, -1, pct, true)).toBe(0);
    expect(formatNumber(66.666)).toBe("66.67");
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(2.5)).toBe("2.5");
  });
});
