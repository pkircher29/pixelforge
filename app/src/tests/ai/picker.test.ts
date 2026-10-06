import { describe, expect, it } from "vitest";
import { chipGlyph, chipTitle, pickerLayout } from "../../lib/ai/picker";
import { mkProvider } from "./fixtures";

const builtins = [mkProvider("open_ai", { name: "ChatGPT" }), mkProvider("x_ai", { name: "Grok" }), mkProvider("gemini", { name: "Gemini" })];

describe("pickerLayout (ProviderPicker overflow rules)", () => {
  it("four or fewer generators are all chips, no dropdown", () => {
    const l = pickerLayout([...builtins, mkProvider("custom:comfy")], "open_ai");
    expect(l.chips.map((p) => p.id)).toEqual(["open_ai", "x_ai", "gemini", "custom:comfy"]);
    expect(l.overflow).toEqual([]);
    expect(l.hasOverflow).toBe(false);
  });

  it("more than four: first four are chips, the rest overflow", () => {
    const list = [...builtins, mkProvider("custom:comfy"), mkProvider("custom:a1111"), mkProvider("custom:hf")];
    const l = pickerLayout(list, "open_ai");
    expect(l.chips.map((p) => p.id)).toEqual(["open_ai", "x_ai", "gemini", "custom:comfy"]);
    expect(l.overflow.map((p) => p.id)).toEqual(["custom:a1111", "custom:hf"]);
    expect(l.hasOverflow).toBe(true);
  });

  it("the selected provider always gets a chip (replaces the last slot)", () => {
    const list = [...builtins, mkProvider("custom:comfy"), mkProvider("custom:a1111"), mkProvider("custom:hf")];
    const l = pickerLayout(list, "custom:hf");
    expect(l.chips.map((p) => p.id)).toEqual(["open_ai", "x_ai", "gemini", "custom:hf"]);
    expect(l.overflow.map((p) => p.id)).toEqual(["custom:comfy", "custom:a1111"]);
  });

  it("prompt-assist-only providers (Ollama) never get a chip", () => {
    const ollama = mkProvider("custom:ollama", { capabilities: { ...mkProvider("x_ai").capabilities, generate: false, instructEdit: false, maskEdit: false }, promptAssist: true, icon: "assist" });
    const l = pickerLayout([...builtins, ollama], "open_ai");
    expect(l.chips.map((p) => p.id)).toEqual(["open_ai", "x_ai", "gemini"]);
    expect(l.hasOverflow).toBe(false);
  });

  it("maxChips is configurable", () => {
    const l = pickerLayout(builtins, "gemini", 2);
    expect(l.chips.map((p) => p.id)).toEqual(["open_ai", "gemini"]);
    expect(l.overflow.map((p) => p.id)).toEqual(["x_ai"]);
  });

  it("glyph and tooltip reflect locality and key state", () => {
    expect(chipGlyph(mkProvider("custom:comfy"))).toBe("🖥 ");
    expect(chipGlyph(mkProvider("open_ai"))).toBe("");
    expect(chipTitle(mkProvider("custom:comfy"))).toMatch(/local, no cost/);
    expect(chipTitle(mkProvider("open_ai", { hasKey: false }))).toMatch(/no key yet/);
    expect(chipTitle(mkProvider("custom:hf", { kind: "hugging_face", local: false, keyOptional: false, hasKey: false, vendor: "Hugging Face" }))).toMatch(/no token yet/);
    expect(chipTitle(mkProvider("open_ai", { hasKey: true, vendor: "OpenAI" }))).toBe("open_ai (OpenAI): key saved");
  });
});
