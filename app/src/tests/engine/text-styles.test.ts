import { expect, it } from "vitest";
import { SetTextLayerCommand, addLayer, createDocument, createTextLayer, rasterizeText, textSpec } from "../../lib/engine";
import { measureLine, textGlyphs } from "../../lib/engine/ops/text";
import { documentFromProjectFrame, projectFrameParts, type ProjectHeader } from "../../lib/io/convert";
import { decodeFrame, encodeFrame } from "../../lib/io/frame";

it("preserves original mixed case and Unicode through style undo and project round-trip", () => {
  const doc = createDocument({ width: 180, height: 100, background: "transparent" });
  const layer = createTextLayer(doc, { text: textSpec("MiXeD Straße", 4, 30, { size: 20 }) });
  addLayer(doc, layer);
  const before = layer.raster.data.slice();
  const command = new SetTextLayerCommand(layer.id, { allCaps: true, smallCaps: true, underline: true, strikethrough: true, paragraphWidth: 120, indentLeft: 3, indentRight: 4, firstLineIndent: 5, spaceBefore: 6, spaceAfter: 7, justification: "right" });
  command.do(doc);
  expect(layer.text.text).toBe("MiXeD Straße");
  expect(layer.raster.data).not.toEqual(before);
  const { header, blobs } = projectFrameParts(doc, "styles.pfproj", "0.3.0", null);
  const restored = documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(header as unknown as Record<string, unknown>, blobs)));
  const back = restored.layers.find(l => l.id === layer.id)!;
  expect(back.kind).toBe("text");
  if (back.kind === "text") expect(back.text).toEqual(layer.text);
  command.undo(doc);
  expect(layer.text.text).toBe("MiXeD Straße");
  expect(layer.raster.data).toEqual(before);
});

it("measures small caps and uppercase expansions using the displayed glyphs", () => {
  const spec = textSpec("Aaß", 0, 30, { size: 20, smallCaps: true });
  expect(textGlyphs(spec, spec.text)).toEqual([{ text: "A", size: 20 }, { text: "A", size: 14 }, { text: "SS", size: 14 }]);
  expect(measureLine(spec, spec.text)).toBeCloseTo(37.2);
  expect(measureLine({ ...spec, allCaps: true }, spec.text)).toBeCloseTo(48);
  expect(spec.text).toBe("Aaß");
});

it("draws continuous decorations across spaces and respects alignment", () => {
  const spec = textSpec("A A", 50, 30, { size: 20, align: "center" });
  const normal = rasterizeText(spec, 100, 70);
  const styled = rasterizeText({ ...spec, underline: true, strikethrough: true }, 100, 70);
  expect(normal.getPixel(50, 24).a).toBe(0);
  expect(styled.getPixel(50, 24).a).toBe(255);
  expect(normal.getPixel(50, 32).a).toBe(0);
  expect(styled.getPixel(50, 32).a).toBe(255);
  expect(styled.getPixel(30, 32).a).toBe(0);
});
