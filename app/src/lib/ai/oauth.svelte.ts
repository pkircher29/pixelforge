/**
 * Subscription sign-in flow per provider ("Sign in with ChatGPT", xAI device flow):
 * a pure reducer (`reduceFlow`, unit-tested) plus a small store that drives the
 * `ai_oauth_*` commands and listens to `ai://oauth`. Tested with mocked invoke/listen in
 * `tests/ai/oauth.test.ts`.
 */

import { authConfigure, hasTauri, oauthCancel, oauthCheckImages, oauthSignOut, oauthStart, oauthStatus, onOAuthEvents, type AuthConfigure } from "./client";
import { toFriendlyError } from "./errors";
import { aiUi } from "./ui.svelte";
import type { ImageAccess, OAuthEvent, OAuthStart, OAuthStatus, ProviderId } from "./types";

export type FlowPhase = "idle" | "starting" | "waiting" | "signed_in" | "error";

export interface FlowState {
  phase: FlowPhase;
  email?: string | undefined;
  plan?: string | undefined;
  error?: string | undefined;
  code?: string | undefined;
  /** What `ai_oauth_start` returned (auth URL, device code). */
  start?: OAuthStart | undefined;
  status?: OAuthStatus | undefined;
  images?: ImageAccess | undefined;
}

export type FlowAction =
  | { type: "start" }
  | { type: "started"; start: OAuthStart }
  | { type: "event"; ev: OAuthEvent }
  | { type: "status"; status: OAuthStatus }
  | { type: "failed"; code: string; message: string }
  | { type: "images"; images: ImageAccess };

export function initialFlow(): FlowState {
  return { phase: "idle" };
}

/** Pure state machine: idle -> starting -> waiting -> signed_in | error; status resyncs. */
export function reduceFlow(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "start":
      return { ...s, phase: "starting", error: undefined, code: undefined, start: undefined };
    case "started":
      // The `waiting` event may already have arrived; never step back from a final state.
      return s.phase === "signed_in" || s.phase === "error" ? { ...s, start: a.start } : { ...s, phase: "waiting", start: a.start };
    case "event":
      switch (a.ev.state) {
        case "waiting":
          return { ...s, phase: "waiting", error: undefined, code: undefined };
        case "signed_in":
          return { ...s, phase: "signed_in", email: a.ev.email, plan: a.ev.plan, error: undefined, code: undefined, start: undefined };
        case "signed_out":
          return { phase: "idle", status: s.status };
        case "error":
          // A user cancel is not an error worth showing.
          if (a.ev.code === "ai_oauth_cancelled") return { ...s, phase: s.status?.signedIn ? "signed_in" : "idle", start: undefined };
          return { ...s, phase: "error", error: a.ev.error ?? "Sign-in failed.", code: a.ev.code, start: undefined };
      }
      return s;
    case "status": {
      const st = a.status;
      const busy = s.phase === "starting" || s.phase === "waiting";
      const phase: FlowPhase = st.pending ? "waiting" : busy ? s.phase : st.signedIn ? "signed_in" : s.phase === "error" ? "error" : "idle";
      return { ...s, status: st, phase, email: st.email ?? (st.signedIn ? s.email : undefined), plan: st.plan, images: st.images ?? s.images };
    }
    case "failed":
      return { ...s, phase: "error", error: a.message, code: a.code, start: undefined };
    case "images":
      return { ...s, images: a.images };
  }
}

class OAuthStore {
  flows = $state<Partial<Record<ProviderId, FlowState>>>({});
  busy = $state<Partial<Record<ProviderId, "" | "check" | "live" | "signout" | "config">>>({});
  private unlisten: (() => void) | null = null;
  private listening: Promise<void> | null = null;

  flow(p: ProviderId): FlowState {
    return this.flows[p] ?? initialFlow();
  }

  private apply(p: ProviderId, a: FlowAction): void {
    this.flows = { ...this.flows, [p]: reduceFlow(this.flow(p), a) };
  }

  /** Listen to `ai://oauth` once (before the first start). */
  ensureListening(): Promise<void> {
    if (!hasTauri()) return Promise.resolve();
    this.listening ??= onOAuthEvents((ev) => {
      this.apply(ev.provider, { type: "event", ev });
      if (ev.state === "signed_in" || ev.state === "signed_out") {
        void this.refresh(ev.provider);
        void aiUi.refreshProviders();
      }
    }).then((un) => {
      this.unlisten = un;
    });
    return this.listening;
  }

  async refresh(p: ProviderId): Promise<OAuthStatus | null> {
    if (!hasTauri()) return null;
    try {
      const status = await oauthStatus(p);
      this.apply(p, { type: "status", status });
      return status;
    } catch (e) {
      const f = toFriendlyError(e);
      this.apply(p, { type: "failed", code: f.code, message: f.detail || f.title });
      return null;
    }
  }

  async start(p: ProviderId): Promise<void> {
    await this.ensureListening();
    this.apply(p, { type: "start" });
    try {
      const start = await oauthStart(p);
      this.apply(p, { type: "started", start });
    } catch (e) {
      const f = toFriendlyError(e);
      this.apply(p, { type: "failed", code: f.code, message: f.detail || f.title });
    }
  }

  async cancel(p: ProviderId): Promise<void> {
    try {
      await oauthCancel(p);
    } finally {
      // The background task reports `ai_oauth_cancelled`, which the reducer swallows.
      this.apply(p, { type: "event", ev: { provider: p, state: "error", code: "ai_oauth_cancelled" } });
    }
  }

  async signOut(p: ProviderId): Promise<void> {
    this.busy = { ...this.busy, [p]: "signout" };
    try {
      const status = await oauthSignOut(p);
      this.apply(p, { type: "event", ev: { provider: p, state: "signed_out" } });
      this.apply(p, { type: "status", status });
      await aiUi.refreshProviders();
    } catch (e) {
      const f = toFriendlyError(e);
      this.apply(p, { type: "failed", code: f.code, message: f.detail || f.title });
    } finally {
      this.busy = { ...this.busy, [p]: "" };
    }
  }

  async checkImages(p: ProviderId, live = false): Promise<ImageAccess | null> {
    this.busy = { ...this.busy, [p]: live ? "live" : "check" };
    try {
      const images = await oauthCheckImages(p, live);
      this.apply(p, { type: "images", images });
      return images;
    } catch (e) {
      const f = toFriendlyError(e);
      this.apply(p, { type: "images", images: { eligible: false, detail: `${f.title} ${f.detail}`.trim(), source: "live", checkedAt: Date.now() / 1000 } });
      return null;
    } finally {
      this.busy = { ...this.busy, [p]: "" };
    }
  }

  async configure(p: ProviderId, cfg: AuthConfigure): Promise<OAuthStatus | null> {
    this.busy = { ...this.busy, [p]: "config" };
    try {
      const status = await authConfigure(p, cfg);
      this.apply(p, { type: "status", status });
      await aiUi.refreshProviders();
      return status;
    } catch (e) {
      const f = toFriendlyError(e);
      this.apply(p, { type: "failed", code: f.code, message: f.detail || f.title });
      return null;
    } finally {
      this.busy = { ...this.busy, [p]: "" };
    }
  }

  /** Tests. */
  reset(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.listening = null;
    this.flows = {};
    this.busy = {};
  }
}

export const oauthStore = new OAuthStore();
