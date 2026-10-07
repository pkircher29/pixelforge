import { describe, expect, it } from "vitest";
import { SetTextLayerCommand, addLayer, createDocument, createTextLayer, textSpec, typeLayerName } from "../../lib/engine";

describe("type layer auto-name (PS)", () => {
  it("follows the text until the layer is renamed, and undo restores it", () => {
    const doc = createDocument({ width: 200, height: 100, background: "white" });
    const l = createTextLayer(doc, { name: "Hello", text: textSpec("Hello", 4, 20, { size: 10 }) });
    addLayer(doc, l);
    const cmd = new SetTextLayerCommand(l.id, { text: "Hello world\nsecond" });
    cmd.do(doc);
    expect(l.name).toBe("Hello world");
    cmd.undo(doc);
    expect(l.name).toBe("Hello");
    l.name = "Title";
    new SetTextLayerCommand(l.id, { text: "Changed" }).do(doc);
    expect(l.name).toBe("Title");
    expect(typeLayerName("a\nb")).toBe("a");
  });
});
