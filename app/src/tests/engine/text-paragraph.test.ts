import { expect, it } from "vitest";
import { layoutText, lineCaretX, moveLayoutCaret, textSpec } from "../../lib/engine/ops/text";

it("wraps at words and keeps paragraph indents, spacing and source positions", () => {
  const spec = textSpec("aa bb cc dd\nZZ", 0, 10, { size: 10, paragraphWidth: 60, indentLeft: 6, indentRight: 6, firstLineIndent: 12, spaceBefore: 3, spaceAfter: 4 });
  const lines = layoutText(spec);
  expect(lines.map(l => [l.start, l.end, l.x, l.y, l.width, l.paragraphEnd])).toEqual([
    [0, 6, 18, 13, 30, false], [6, 11, 6, 25, 30, true], [12, 14, 18, 44, 12, true],
  ]);
  expect(spec.x).toBe(0);
  expect(spec.text).toBe("aa bb cc dd\nZZ");
  expect(lineCaretX(lines[0]!, 6)).toBe(48);
  expect(lineCaretX(lines[1]!, 7)).toBe(12);
  expect(moveLayoutCaret(spec, 7, "Home")).toBe(6);
  expect(moveLayoutCaret(spec, 7, "End")).toBe(11);
  expect(moveLayoutCaret(spec, 2, "ArrowDown")).toBe(10);
  expect(moveLayoutCaret(spec, 10, "ArrowUp")).toBe(2);
});

it("justifies wrapped lines and applies each last-line alignment", () => {
  const spec = textSpec("aa bb cc", 0, 10, { size: 10, paragraphWidth: 36 });
  for (const [mode, lastX, lastWidth] of [["left", 0, 12], ["center", 12, 12], ["right", 24, 12], ["all", 0, 36]] as const) {
    const lines = layoutText({ ...spec, justification: mode });
    expect(lines[0]!.width).toBe(36);
    expect(lines[0]!.glyphs[3]!.x).toBe(24);
    expect(lines[1]!.x).toBe(lastX);
    expect(lines[1]!.width).toBe(lastWidth);
  }
});

it("breaks long words without splitting surrogate pairs and handles empty paragraphs", () => {
  const spec = textSpec("😀abc\r\n\r\nZ", 0, 10, { size: 10, paragraphWidth: 12 });
  const lines = layoutText(spec);
  expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5], [7, 7], [9, 10]]);
  expect(lines[0]!.glyphs[0]!.end).toBe(2);
  expect(layoutText(textSpec("", 0, 10))).toHaveLength(1);
});

it("retains unwrapped point-type alignment when paragraph formatting is absent", () => {
  for (const [align, x] of [["left", 40], ["center", 34], ["right", 28]] as const) {
    const [line] = layoutText(textSpec("AB", 40, 20, { size: 10, align }));
    expect([line!.x, line!.y, line!.width]).toEqual([x, 20, 12]);
  }
});
