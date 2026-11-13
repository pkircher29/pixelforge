import { expect, it } from "vitest";
import { readPrompts, savePrompt } from "../../lib/ai/prompt-library";

const entry = { id: "a", name: "Portrait", prompt: "Soft window light", negativePrompt: "text, watermark" };

it("round-trips multiline prompts and enabled negative text without retaining unrelated fields", () => {
  const original = { ...entry, prompt: "First line\nSecond line", provider: "do not retain", apiKey: "dummy" };
  expect(readPrompts(JSON.parse(JSON.stringify([original])))).toEqual([{ ...entry, prompt: original.prompt }]);
});

it("rejects malformed and duplicate records and bounds the stored library", () => {
  expect(readPrompts(null)).toEqual([]);
  expect(readPrompts([null, {}, entry, entry, { ...entry, id: "b", prompt: 42 }, { ...entry, id: "c", name: " " }])).toEqual([entry]);
  expect(readPrompts(Array.from({ length: 250 }, (_, i) => ({ ...entry, id: String(i) })))).toHaveLength(200);
});

it("updates only the selected ID and rejects accidental overwrites and excess entries", () => {
  const second = { ...entry, id: "b", name: "Landscape" };
  expect(savePrompt([entry, second], { ...entry, name: "Updated", prompt: "new" })).toEqual([second, { ...entry, name: "Updated", prompt: "new" }]);
  expect(() => savePrompt([entry], { ...second, name: " portrait " })).toThrow(/already used/);
  expect(() => savePrompt([], { ...entry, prompt: " " })).toThrow(/Enter/);
  expect(() => savePrompt([], { ...entry, prompt: "x".repeat(20001) })).toThrow(/Enter/);
  const full = Array.from({ length: 200 }, (_, i) => ({ ...entry, id: String(i), name: String(i) }));
  expect(() => savePrompt(full, entry)).toThrow(/200/);
  expect(savePrompt(full, { ...full[0]!, prompt: "updated" })).toHaveLength(200);
});
