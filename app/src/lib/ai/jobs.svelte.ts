/**
 * Reactive job list. One `AiJob` per submitted request, driven by the `ai://jobs` event
 * stream (registered before the first submit, as `docs/ipc.md` requires) and finished by
 * `ai_take_result`. Raw PNG bytes stay here until `run.ts` decodes them into layers.
 *
 * Tested with a mocked `invoke` / `listen` in `tests/ai/jobs.test.ts`.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { cancelJob, onJobEvents, takeResult, type TakenResult } from "./client";
import { describeAiError, toFriendlyError, type FriendlyError } from "./errors";
import type { AiMode, ImageResultMeta, JobEvent, JobId, ProviderId } from "./types";

export type AiJobState = "submitting" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AiJobDesc {
  provider: ProviderId;
  providerName: string;
  model: string;
  mode: AiMode;
  emulated: boolean;
  prompt: string;
  /** Document the result belongs to (null = opens a new document). */
  docId: string | null;
  /** History entry to update on completion. */
  historyId: string | null;
  /** Variants requested. */
  n: number;
}

export interface AiJob extends AiJobDesc {
  /** Local id, assigned before the Rust `JobId` arrives. */
  id: string;
  jobId: JobId | null;
  state: AiJobState;
  /** 0..100 or null (no provider streams progress today). */
  pct: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Provider wall time as reported by the `completed` event. */
  durationMs: number | null;
  error: FriendlyError | null;
  /** Result metadata from the `completed` event. */
  resultMeta: ImageResultMeta[] | null;
  /** PNG bytes + meta once fetched with `ai_take_result`. */
  results: TakenResult[] | null;
  /** Indices of `results` already turned into layers. */
  applied: number[];
}

export const TERMINAL: ReadonlySet<AiJobState> = new Set(["completed", "failed", "cancelled"]);

let localCounter = 0;

class JobStore {
  jobs = $state<AiJob[]>([]);
  /** Ticks every 250 ms while something is active, for elapsed-time labels. */
  now = $state(Date.now());

  private unlisten: UnlistenFn | null = null;
  private listening: Promise<void> | null = null;
  /** Events for Rust job ids we have not matched to a local job yet. */
  private orphanEvents = new Map<JobId, JobEvent[]>();
  private waiters = new Map<string, { resolve: (job: AiJob) => void }>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  get active(): AiJob[] {
    return this.jobs.filter((j) => !TERMINAL.has(j.state));
  }

  get finished(): AiJob[] {
    return this.jobs.filter((j) => TERMINAL.has(j.state));
  }

  byId(id: string): AiJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  /** Register the `ai://jobs` listener once. Safe to call repeatedly. */
  ensureListening(): Promise<void> {
    if (!this.listening) {
      this.listening = onJobEvents((ev) => this.onEvent(ev))
        .then((un) => {
          this.unlisten = un;
        })
        .catch((e: unknown) => {
          this.listening = null;
          throw e;
        });
    }
    return this.listening;
  }

  /**
   * Submit a job. `submitFn` performs the actual `ai_submit_*` call and returns the Rust
   * id; the listener is guaranteed to be registered before it runs.
   */
  async submit(desc: AiJobDesc, submitFn: () => Promise<JobId>): Promise<AiJob> {
    const job: AiJob = {
      ...desc,
      id: `job_${++localCounter}_${Date.now().toString(36)}`,
      jobId: null,
      state: "submitting",
      pct: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      error: null,
      resultMeta: null,
      results: null,
      applied: [],
    };
    this.jobs.unshift(job);
    this.startTicker();
    try {
      await this.ensureListening();
      const jobId = await submitFn();
      const live = this.byId(job.id)!;
      live.jobId = jobId;
      if (live.state === "submitting") live.state = "queued";
      const buffered = this.orphanEvents.get(jobId);
      if (buffered) {
        this.orphanEvents.delete(jobId);
        for (const ev of buffered) this.applyEvent(live, ev);
      }
      return live;
    } catch (e) {
      const live = this.byId(job.id)!;
      live.state = "failed";
      live.error = toFriendlyError(e);
      live.finishedAt = Date.now();
      this.settle(live);
      return live;
    }
  }

  /** Resolves when the job reaches a terminal state (results fetched when completed). */
  whenDone(id: string): Promise<AiJob> {
    const job = this.byId(id);
    if (!job) return Promise.reject(new Error(`unknown job ${id}`));
    if (TERMINAL.has(job.state) && (job.state !== "completed" || job.results !== null || job.error)) {
      return Promise.resolve(job);
    }
    return new Promise((resolve) => this.waiters.set(id, { resolve }));
  }

  async cancel(id: string): Promise<void> {
    const job = this.byId(id);
    if (!job || TERMINAL.has(job.state)) return;
    if (job.jobId) {
      try {
        await cancelJob(job.jobId);
      } catch {
        // The job may have finished in the meantime; the event stream has the truth.
      }
    } else {
      // Not yet accepted by Rust: mark locally; the submit path will reconcile.
      job.state = "cancelled";
      job.finishedAt = Date.now();
      this.settle(job);
    }
  }

  remove(id: string): void {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i >= 0 && TERMINAL.has(this.jobs[i]!.state)) this.jobs.splice(i, 1);
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => !TERMINAL.has(j.state));
  }

  /** Elapsed ms for the UI (provider time when finished, wall time while running). */
  elapsedMs(job: AiJob): number {
    if (job.durationMs !== null) return job.durationMs;
    const end = job.finishedAt ?? this.now;
    return Math.max(0, end - (job.startedAt ?? job.createdAt));
  }

  /** Feed an event (public so tests can drive the store without the event plugin). */
  onEvent(ev: JobEvent): void {
    const job = this.jobs.find((j) => j.jobId === ev.job);
    if (!job) {
      const list = this.orphanEvents.get(ev.job) ?? [];
      list.push(ev);
      this.orphanEvents.set(ev.job, list);
      return;
    }
    this.applyEvent(job, ev);
  }

  private applyEvent(job: AiJob, ev: JobEvent): void {
    if (TERMINAL.has(job.state)) return;
    switch (ev.type) {
      case "queued":
        job.state = "queued";
        break;
      case "started":
        job.state = "running";
        job.startedAt = Date.now();
        break;
      case "progress":
        job.state = "running";
        job.pct = ev.pct;
        break;
      case "completed":
        job.state = "completed";
        job.pct = 100;
        job.finishedAt = Date.now();
        job.durationMs = ev.durationMs;
        job.resultMeta = ev.results;
        void this.fetchResults(job);
        break;
      case "failed":
        job.state = "failed";
        job.finishedAt = Date.now();
        job.error = describeAiError(ev.code, ev.message);
        this.settle(job);
        break;
      case "cancelled":
        job.state = "cancelled";
        job.finishedAt = Date.now();
        this.settle(job);
        break;
    }
  }

  private async fetchResults(job: AiJob): Promise<void> {
    if (!job.jobId) return;
    try {
      job.results = await takeResult(job.jobId);
    } catch (e) {
      job.state = "failed";
      job.error = toFriendlyError(e);
    }
    this.settle(job);
  }

  private settle(job: AiJob): void {
    const w = this.waiters.get(job.id);
    if (w) {
      this.waiters.delete(job.id);
      w.resolve(job);
    }
    if (this.active.length === 0) this.stopTicker();
  }

  private startTicker(): void {
    if (this.ticker || typeof setInterval !== "function") return;
    this.ticker = setInterval(() => {
      this.now = Date.now();
    }, 250);
  }

  private stopTicker(): void {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Tear down (tests). */
  dispose(): void {
    this.stopTicker();
    this.unlisten?.();
    this.unlisten = null;
    this.listening = null;
    this.orphanEvents.clear();
    this.waiters.clear();
    this.jobs = [];
  }
}

export const jobStore = new JobStore();
