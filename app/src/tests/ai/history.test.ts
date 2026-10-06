import { describe, expect, it } from "vitest";
import { createDocument } from "../../lib/engine";
import {
  AI_HISTORY_KEY,
  addEntry,
  deserializeHistory,
  findEntry,
  getHistory,
  isAiHistoryEntry,
  lastEntry,
  newHistoryId,
  removeEntry,
  serializeHistory,
  updateEntry,
  type AiHistoryEntry,
} from "../../lib/ai/history";

function entry(over: Partial<AiHistoryEntry> = {}): AiHistoryEntry {
  return {
    id: newHistoryId(),
    ts: 1700000000000,
    provider: "gemini",
    providerName: "Gemini",
    model: "gemini-3.1-flash-image",
    mode: "mask",
    emulated: true,
    prompt: "add a hat",
    n: 1,
    resultThumbs: ["data:image/jpeg;base64,AAAA"],
    resultLayerIds: ["layer_1"],
    durationMs: 1234,
    status: "completed",
    maskRect: { x: 1, y: 2, w: 3, h: 4 },
    inputThumb: "data:image/jpeg;base64,BBBB",
    maskThumb: "data:image/png;base64,CCCC",
    costUsd: 0.067,
    ...over,
  };
}

describe("AI history on doc.meta", () => {
  it("creates the slot lazily and appends", () => {
    const doc = createDocument({ width: 4, height: 4 });
    expect(doc.meta[AI_HISTORY_KEY]).toBeUndefined();
    expect(getHistory(doc)).toEqual([]);
    expect(Array.isArray(doc.meta[AI_HISTORY_KEY])).toBe(true);
    const e = addEntry(doc, entry());
    expect(getHistory(doc)).toHaveLength(1);
    expect(findEntry(doc, e.id)).toBe(e);
    expect(lastEntry(doc)).toBe(e);
    expect(doc.dirty).toBe(true);
  });

  it("update / remove", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const e = addEntry(doc, entry({ status: "running" }));
    expect(updateEntry(doc, e.id, { status: "failed", error: { code: "ai_timeout", message: "180 s" } })?.status).toBe("failed");
    expect(updateEntry(doc, "nope", { status: "failed" })).toBeUndefined();
    expect(removeEntry(doc, e.id)).toBe(true);
    expect(removeEntry(doc, e.id)).toBe(false);
    expect(getHistory(doc)).toEqual([]);
  });

  it("round-trips through JSON (manifest ai_history) without loss", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const a = addEntry(doc, entry());
    const b = addEntry(doc, entry({ mode: "generate", emulated: false, provider: "x_ai", providerName: "Grok", status: "failed", error: { code: "ai_auth", message: "401" } }));
    const json = JSON.stringify(serializeHistory(getHistory(doc)));
    const back = deserializeHistory(JSON.parse(json));
    expect(back).toHaveLength(2);
    expect(back[0]).toEqual(a);
    expect(back[1]).toEqual(b);
    expect(back[0]!.maskRect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("drops malformed entries when reading a manifest", () => {
    expect(deserializeHistory("nope")).toEqual([]);
    const good = entry();
    const list = deserializeHistory([good, { id: "x" }, null, 42, { ...good, mode: "weird" }]);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(good.id);
    expect(isAiHistoryEntry({ ...good, resultThumbs: "no" })).toBe(false);
  });

  it("repairs a garbled meta slot in place", () => {
    const doc = createDocument({ width: 4, height: 4 });
    doc.meta[AI_HISTORY_KEY] = [entry(), { bogus: true }];
    expect(getHistory(doc)).toHaveLength(1);
    expect((doc.meta[AI_HISTORY_KEY] as unknown[]).length).toBe(1);
    doc.meta[AI_HISTORY_KEY] = "garbage";
    expect(getHistory(doc)).toEqual([]);
  });

  it("ids are unique", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHistoryId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith("ai_")).toBe(true);
  });
});
