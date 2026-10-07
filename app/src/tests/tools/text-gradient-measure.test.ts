import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteBackward,
  deleteForward,
  emptyModel,
  fromTextarea,
  indexAt,
  insertText,
  linePosOf,
  moveCaret,
  selectAll,
  selectedText,
  selectionSpans,
} from "../../lib/tools/text-session";
import {
  addColorStop,
  addOpacityStop,
  evalAlpha,
  evalColor,
  gradientDef,
  midpointCurve,
  moveColorStop,
  parseGradient,
  removeColorStop,
  serializeGradient,
  setColorMidpoint,
  toEngineGradient,
} from "../../lib/tools/gradient-model";
import { DEFAULT_GRADIENTS } from "../../lib/tools/gradient-presets";
import { gradientT, paintGradient } from "../../lib/tools/gradient-paint";
import { measureLine, straightenAngle } from "../../lib/tools/measure";
import { toolStore } from "../../lib/stores/tool.svelte";
import { Raster } from "../../lib/engine";

const black = { r: 0, g: 0, b: 0, a: 255 };
const white = { r: 255, g: 255, b: 255, a: 255 };

describe("text editing session model", () => {
  it("inserts at the caret and replaces the selection", () => {
    let m = insertText(emptyModel(), "Hello");
    expect(m).toEqual({ text: "Hello", caret: 5, anchor: 5 });
    m = { ...m, anchor: 0 };
    expect(selectedText(m)).toBe("Hello");
    m = insertText(m, "Hi");
    expect(m.text).toBe("Hi");
  });

  it("backspace / delete remove one char or the selection", () => {
    const m = { text: "abc", caret: 2, anchor: 2 };
    expect(deleteBackward(m)).toEqual({ text: "ac", caret: 1, anchor: 1 });
    expect(deleteForward(m)).toEqual({ text: "ab", caret: 2, anchor: 2 });
    expect(deleteBackward({ text: "abc", caret: 0, anchor: 0 }).text).toBe("abc");
    expect(deleteBackward({ text: "abcd", caret: 3, anchor: 1 }).text).toBe("ad");
  });

  it("Enter makes multi-line text; line/col mapping round-trips", () => {
    let m = insertText(emptyModel("ab"), "\n");
    m = insertText(m, "cd");
    expect(m.text).toBe("ab\ncd");
    expect(linePosOf(m.text, 4)).toEqual({ line: 1, col: 1 });
    expect(indexAt(m.text, 1, 1)).toBe(4);
    expect(indexAt(m.text, 0, 99)).toBe(2);
  });

  it("caret moves left/right/up/down/home/end and Shift extends", () => {
    const t = "abc\nde";
    let m = { text: t, caret: 5, anchor: 5 };
    m = moveCaret(m, "up");
    expect(m.caret).toBe(1);
    m = moveCaret(m, "down");
    expect(m.caret).toBe(5);
    m = moveCaret(m, "home", true);
    expect([m.caret, m.anchor]).toEqual([4, 5]);
    m = moveCaret(m, "right");
    expect([m.caret, m.anchor]).toEqual([5, 5]);
    expect(moveCaret({ text: t, caret: 0, anchor: 0 }, "end").caret).toBe(3);
    expect(moveCaret({ text: t, caret: 0, anchor: 0 }, "left").caret).toBe(0);
  });

  it("surrogate pairs move as one character", () => {
    const m = insertText(emptyModel(), "a😀");
    expect(deleteBackward(m).text).toBe("a");
    expect(moveCaret(m, "left").caret).toBe(1);
  });

  it("select all, textarea sync and selection spans across lines", () => {
    const m = selectAll(emptyModel("ab\ncde"));
    expect(selectedText(m)).toBe("ab\ncde");
    expect(fromTextarea("xyz", 1, 3, "backward")).toEqual({ text: "xyz", caret: 1, anchor: 3 });
    expect(selectionSpans({ text: "ab\ncde", caret: 4, anchor: 1 })).toEqual([
      { line: 0, start: 1, end: 2 },
      { line: 1, start: 0, end: 1 },
    ]);
  });
});

describe("gradient editor stop model", () => {
  const bw = () => gradientDef("t", "t", [black, white]);

  it("evaluates colour linearly with a centred midpoint", () => {
    expect(evalColor(bw(), 0).r).toBe(0);
    expect(evalColor(bw(), 1).r).toBe(255);
    expect(evalColor(bw(), 0.5).r).toBeCloseTo(127.5);
  });

  it("midpoint moves the 50 % blend", () => {
    expect(midpointCurve(0.25, 0.25)).toBeCloseTo(0.5);
    const g = setColorMidpoint(bw(), 0, 0.25);
    expect(evalColor(g, 0.25).r).toBeCloseTo(127.5);
  });

  it("add / move / delete colour stops (min 2)", () => {
    const { def, index } = addColorStop(bw(), 0.5, { r: 255, g: 0, b: 0, a: 255 });
    expect(def.colorStops).toHaveLength(3);
    expect(evalColor(def, 0.5)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    const moved = moveColorStop(def, index, 0.75);
    expect(evalColor(moved, 0.75).g).toBe(0);
    expect(removeColorStop(removeColorStop(moved, index), 0).colorStops).toHaveLength(2);
  });

  it("opacity stops evaluate independently", () => {
    const g = gradientDef("t", "t", [black, black], [1, 0]);
    expect(evalAlpha(g, 0.5)).toBeCloseTo(0.5);
    const { def } = addOpacityStop(g, 0.5, 1);
    expect(evalAlpha(def, 0.5)).toBe(1);
  });

  it("fg / bg stops resolve at paint time and flatten to the engine gradient", () => {
    const fgbg = DEFAULT_GRADIENTS.find((g) => g.id === "fg-bg")!;
    const eng = toEngineGradient(fgbg, { r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 255, a: 255 });
    expect(eng.stops[0]!.color).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(eng.stops[eng.stops.length - 1]!.color.b).toBe(255);
    expect(eng.stops.length).toBeGreaterThan(10);
    expect(DEFAULT_GRADIENTS.length).toBeGreaterThanOrEqual(16);
  });

  it("serializes and parses round-trip; rejects junk", () => {
    const g = bw();
    expect(parseGradient(serializeGradient(g))).toEqual(g);
    expect(parseGradient("nope")).toBeNull();
    expect(parseGradient("fg-bg")).toBeNull();
  });

  it("gradient styles: linear / radial / reflected / angle / diamond parameter", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(gradientT("linear", 5, 0, a, b)).toBeCloseTo(0.5);
    expect(gradientT("radial", 0, 5, a, b)).toBeCloseTo(0.5);
    expect(gradientT("reflected", -5, 0, a, b)).toBeCloseTo(0.5);
    expect(gradientT("angle", 0, 5, a, b)).toBeCloseTo(0.25);
    expect(gradientT("diamond", 3, 5, a, b)).toBeCloseTo(0.5);
  });

  it("paints a black→white ramp and honours transparency off", () => {
    const r = new Raster(11, 1);
    paintGradient(r, { x: 0.5, y: 0.5 }, { x: 10.5, y: 0.5 }, toEngineGradient(gradientDef("t", "t", [black, white])), { style: "linear", dither: false });
    expect(r.getPixel(0, 0).r).toBe(0);
    expect(r.getPixel(10, 0).r).toBe(255);
    const r2 = new Raster(4, 1);
    paintGradient(r2, { x: 0, y: 0 }, { x: 4, y: 0 }, toEngineGradient(gradientDef("t", "t", [black, black], [0, 0])), { style: "linear", transparency: false, dither: false });
    expect(r2.getPixel(2, 0).a).toBe(255);
  });
});

describe("ruler / color sampler store math", () => {
  beforeEach(() => toolStore.clearColorSamplers());

  it("measures length, PS angle (CCW positive) and deltas", () => {
    const m = measureLine(0, 0, 30, -40);
    expect(m.length).toBe(50);
    expect(m.angle).toBeCloseTo(53.13, 1);
    expect([m.dx, m.dy]).toEqual([30, -40]);
    expect(measureLine(0, 0, -10, 0).angle).toBeCloseTo(180);
  });

  it("straighten picks the nearest axis", () => {
    expect(straightenAngle(measureLine(0, 0, 100, -5))).toBeCloseTo(2.86, 1);
    expect(straightenAngle(measureLine(0, 0, 100, 5))).toBeCloseTo(-2.86, 1);
    // Near-vertical line leaning right at the bottom → rotate clockwise to make it vertical.
    expect(straightenAngle(measureLine(0, 0, 3, 100))).toBeCloseTo(1.72, 1);
  });

  it("color samplers: max 4, numbered, reuse freed ids", () => {
    const c = { r: 1, g: 2, b: 3, a: 255 };
    for (let i = 0; i < 4; i++) expect(toolStore.addColorSampler(i, i, c)).not.toBeNull();
    expect(toolStore.addColorSampler(9, 9, c)).toBeNull();
    toolStore.removeColorSampler(2);
    expect(toolStore.addColorSampler(5, 5, c)!.id).toBe(2);
    toolStore.updateColorSampler(2, { color: { r: 9, g: 9, b: 9, a: 255 } });
    expect(toolStore.colorSamplers.find((s) => s.id === 2)!.color.r).toBe(9);
    expect(toolStore.colorSamplers.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});
