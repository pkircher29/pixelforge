import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { decodeFrame, encodeFrame } from "../../lib/io/frame";
import {
  buildEditFrame,
  cancelJob,
  deleteKey,
  jobStatus,
  listProviders,
  parseResultFrame,
  setKey,
  submitEdit,
  submitGenerate,
  takeResult,
  testKey,
} from "../../lib/ai/client";
import type { EditFrameHeader, ImageResultMeta } from "../../lib/ai/types";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("buildEditFrame (docs/ipc.md ai_submit_edit)", () => {
  it("composite only: header mask=false refs=0, one blob", () => {
    const body = buildEditFrame({ provider: "gemini", mode: "instruct", prompt: "p" }, { composite: bytes("IMG") });
    const { header, blobs } = decodeFrame<EditFrameHeader>(body);
    expect(header.provider).toBe("gemini");
    expect(header.mode).toBe("instruct");
    expect(header.prompt).toBe("p");
    expect(header.mask).toBe(false);
    expect(header.refs).toBe(0);
    expect(header.blobs).toEqual([3]);
    expect(blobs).toHaveLength(1);
    expect(new TextDecoder().decode(blobs[0])).toBe("IMG");
  });

  it("blob order is composite, mask, refs... and the header counts match", () => {
    const body = buildEditFrame(
      { provider: "open_ai", mode: "mask", prompt: "fix", n: 2, size: { width: 1024, height: 1024 }, quality: "high", timeoutSecs: 300 },
      { composite: bytes("IMG"), mask: bytes("MASK"), refs: [bytes("R0"), bytes("R1")] },
    );
    const { header, blobs } = decodeFrame<EditFrameHeader>(body);
    expect(header.mask).toBe(true);
    expect(header.refs).toBe(2);
    expect(header.blobs).toEqual([3, 4, 2, 2]);
    expect(blobs.map((b) => new TextDecoder().decode(b))).toEqual(["IMG", "MASK", "R0", "R1"]);
    expect(header.n).toBe(2);
    expect(header.size).toEqual({ width: 1024, height: 1024 });
    expect(header.quality).toBe("high");
    expect(header.timeoutSecs).toBe(300);
    // Frame layout: u32 LE header length, then the JSON header.
    const headerLen = new DataView(body.buffer, body.byteOffset).getUint32(0, true);
    const json = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + headerLen))) as Record<string, unknown>;
    expect(json.blobs).toEqual([3, 4, 2, 2]);
    expect(body.byteLength).toBe(4 + headerLen + 3 + 4 + 2 + 2);
  });

  it("refuses an empty composite", () => {
    expect(() => buildEditFrame({ provider: "x_ai", mode: "instruct", prompt: "p" }, { composite: new Uint8Array(0) })).toThrow();
  });
});

describe("parseResultFrame (ai_take_result)", () => {
  const meta: ImageResultMeta = { width: 2, height: 3, provider: "x_ai", model: "grok-imagine-image-2.0", mime: "image/png", bytes: 3, costUsd: 0.04 };

  it("pairs each result with its PNG blob", () => {
    const frame = encodeFrame({ results: [meta, { ...meta, costUsd: undefined }] }, [bytes("PNG"), bytes("")]);
    const out = parseResultFrame(frame);
    expect(out).toHaveLength(2);
    expect(out[0]!.meta.costUsd).toBe(0.04);
    expect(new TextDecoder().decode(out[0]!.png)).toBe("PNG");
    expect(out[1]!.png.byteLength).toBe(0);
  });

  it("rejects a results/blobs mismatch", () => {
    const frame = encodeFrame({ results: [meta] }, [bytes("a"), bytes("b")]);
    expect(() => parseResultFrame(frame)).toThrow(/results but 2 blobs/);
  });
});

describe("command wrappers call the right Tauri commands", () => {
  beforeEach(() => invoke.mockReset());

  it("JSON-arg commands", async () => {
    invoke.mockResolvedValue(null);
    await listProviders();
    expect(invoke).toHaveBeenLastCalledWith("ai_list_providers");
    await submitGenerate({ provider: "gemini", prompt: "hi", n: 1 });
    expect(invoke).toHaveBeenLastCalledWith("ai_submit_generate", { params: { provider: "gemini", prompt: "hi", n: 1 } });
    await jobStatus("j1");
    expect(invoke).toHaveBeenLastCalledWith("ai_job_status", { job: "j1" });
    await cancelJob("j1");
    expect(invoke).toHaveBeenLastCalledWith("ai_cancel", { job: "j1" });
    await testKey("x_ai");
    expect(invoke).toHaveBeenLastCalledWith("ai_test_key", { provider: "x_ai" });
    await setKey("open_ai", "sk-1");
    expect(invoke).toHaveBeenLastCalledWith("settings_set_key", { provider: "open_ai", key: "sk-1" });
    await deleteKey("gemini");
    expect(invoke).toHaveBeenLastCalledWith("settings_delete_key", { provider: "gemini" });
  });

  it("submitEdit sends a raw frame body, takeResult decodes a raw frame", async () => {
    invoke.mockResolvedValueOnce("jobid");
    const id = await submitEdit({ provider: "open_ai", mode: "mask", prompt: "p" }, { composite: bytes("I"), mask: bytes("M") });
    expect(id).toBe("jobid");
    const [cmd, body] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(cmd).toBe("ai_submit_edit");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(decodeFrame(body).blobs).toHaveLength(2);

    const meta: ImageResultMeta = { width: 1, height: 1, provider: "open_ai", model: "m", mime: "image/png", bytes: 1 };
    invoke.mockResolvedValueOnce(encodeFrame({ results: [meta] }, [bytes("P")]).buffer);
    const res = await takeResult("jobid");
    expect(invoke).toHaveBeenLastCalledWith("ai_take_result", { job: "jobid" });
    expect(res[0]!.meta.model).toBe("m");
  });
});
