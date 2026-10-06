import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../lib/ai/types";

type Handler = (e: { payload: JobEvent }) => void;
const handlers: Handler[] = [];
const invoke = vi.fn();
const listen = vi.fn(async (_name: string, cb: Handler) => {
  handlers.push(cb);
  return () => {
    const i = handlers.indexOf(cb);
    if (i >= 0) handlers.splice(i, 1);
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, cb: Handler) => listen(name, cb) }));

import { encodeFrame } from "../../lib/io/frame";
import { jobStore, type AiJobDesc } from "../../lib/ai/jobs.svelte";

const desc: AiJobDesc = {
  provider: "x_ai",
  providerName: "Grok",
  model: "grok-imagine-image-2.0",
  mode: "instruct",
  emulated: false,
  prompt: "sketch",
  docId: "doc1",
  historyId: null,
  n: 1,
};

function emit(ev: JobEvent): void {
  for (const h of [...handlers]) h({ payload: ev });
}

const meta = { width: 1, height: 1, provider: "x_ai" as const, model: "m", mime: "image/png", bytes: 3 };

beforeEach(() => {
  invoke.mockReset();
  listen.mockClear();
  handlers.length = 0;
  jobStore.dispose();
});

afterEach(() => jobStore.dispose());

describe("jobStore", () => {
  it("registers the ai://jobs listener before submitting, then walks queued -> running -> completed and fetches the result", async () => {
    const order: string[] = [];
    invoke.mockImplementation(async (cmd: string) => {
      order.push(cmd);
      if (cmd === "ai_take_result") return encodeFrame({ results: [meta] }, [new Uint8Array([1, 2, 3])]).buffer;
      return null;
    });
    const job = await jobStore.submit(desc, async () => {
      order.push("submit");
      expect(listen).toHaveBeenCalledWith("ai://jobs", expect.any(Function));
      return "J1";
    });
    expect(order[0]).toBe("submit");
    expect(job.jobId).toBe("J1");
    expect(job.state).toBe("queued");

    emit({ job: "J1", provider: "x_ai", type: "started" });
    expect(jobStore.byId(job.id)!.state).toBe("running");
    emit({ job: "J1", provider: "x_ai", type: "progress", pct: null });
    expect(jobStore.active).toHaveLength(1);

    emit({ job: "J1", provider: "x_ai", type: "completed", results: [meta], durationMs: 777 });
    const done = await jobStore.whenDone(job.id);
    expect(done.state).toBe("completed");
    expect(done.durationMs).toBe(777);
    expect(done.resultMeta).toEqual([meta]);
    expect(done.results).toHaveLength(1);
    expect(Array.from(done.results![0]!.png)).toEqual([1, 2, 3]);
    expect(invoke).toHaveBeenCalledWith("ai_take_result", { job: "J1" });
    expect(jobStore.elapsedMs(done)).toBe(777);
    expect(jobStore.active).toHaveLength(0);
    expect(jobStore.finished).toHaveLength(1);
  });

  it("buffers events that arrive before the submit promise resolves", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "ai_take_result" ? encodeFrame({ results: [meta] }, [new Uint8Array([9])]).buffer : null,
    );
    const job = await jobStore.submit(desc, async () => {
      // Rust emits queued/started/completed before the id reaches JS (fast local failure or cache hit).
      emit({ job: "J2", provider: "x_ai", type: "queued" });
      emit({ job: "J2", provider: "x_ai", type: "started" });
      emit({ job: "J2", provider: "x_ai", type: "completed", results: [meta], durationMs: 5 });
      return "J2";
    });
    const done = await jobStore.whenDone(job.id);
    expect(done.state).toBe("completed");
    expect(done.results).toHaveLength(1);
  });

  it("maps a failed event to a friendly error with the typed code", async () => {
    invoke.mockResolvedValue(null);
    const job = await jobStore.submit(desc, async () => "J3");
    emit({ job: "J3", provider: "x_ai", type: "failed", code: "ai_rate_limited", message: "429 Too Many Requests; Retry-After: 30" });
    const done = await jobStore.whenDone(job.id);
    expect(done.state).toBe("failed");
    expect(done.error?.code).toBe("ai_rate_limited");
    expect(done.error?.retryAfterSecs).toBe(30);
    expect(done.error?.retryable).toBe(true);
  });

  it("a submit rejection (e.g. ai_not_configured) fails the job locally", async () => {
    const job = await jobStore.submit(desc, async () => {
      throw { code: "ai_not_configured", message: "no key for Grok" };
    });
    expect(job.state).toBe("failed");
    expect(job.error?.code).toBe("ai_not_configured");
    expect(job.error?.hint).toMatch(/AI Providers/);
    expect((await jobStore.whenDone(job.id)).state).toBe("failed");
  });

  it("cancel calls ai_cancel and the cancelled event settles the job", async () => {
    invoke.mockResolvedValue(true);
    const job = await jobStore.submit(desc, async () => "J4");
    emit({ job: "J4", provider: "x_ai", type: "started" });
    await jobStore.cancel(job.id);
    expect(invoke).toHaveBeenCalledWith("ai_cancel", { job: "J4" });
    emit({ job: "J4", provider: "x_ai", type: "cancelled" });
    const done = await jobStore.whenDone(job.id);
    expect(done.state).toBe("cancelled");
    // Events after a terminal state are ignored.
    emit({ job: "J4", provider: "x_ai", type: "completed", results: [], durationMs: 1 });
    expect(jobStore.byId(job.id)!.state).toBe("cancelled");
  });

  it("remove only drops finished jobs; clearFinished keeps active ones", async () => {
    invoke.mockResolvedValue(null);
    const a = await jobStore.submit(desc, async () => "J5");
    const b = await jobStore.submit(desc, async () => "J6");
    jobStore.remove(a.id);
    expect(jobStore.jobs).toHaveLength(2);
    emit({ job: "J5", provider: "x_ai", type: "failed", code: "ai_http", message: "500" });
    jobStore.remove(a.id);
    expect(jobStore.jobs.map((j) => j.id)).toEqual([b.id]);
    jobStore.clearFinished();
    expect(jobStore.jobs).toHaveLength(1);
  });

  it("a failing ai_take_result turns a completed job into a failure", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_take_result") throw { code: "ai_no_result", message: "already taken" };
      return null;
    });
    const job = await jobStore.submit(desc, async () => "J7");
    emit({ job: "J7", provider: "x_ai", type: "completed", results: [meta], durationMs: 1 });
    const done = await jobStore.whenDone(job.id);
    expect(done.state).toBe("failed");
    expect(done.error?.code).toBe("ai_no_result");
  });
});
