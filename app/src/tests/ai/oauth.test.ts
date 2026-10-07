import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
let oauthHandler: ((e: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (topic: string, h: (e: { payload: unknown }) => void) => {
    if (topic === "ai://oauth") oauthHandler = h;
    return () => {
      oauthHandler = null;
    };
  }),
}));

import { authItems, authModeOf, subscriptionView } from "../../lib/ai/auth-ui";
import { describeAiError } from "../../lib/ai/errors";
import { initialFlow, oauthStore, reduceFlow, type FlowState } from "../../lib/ai/oauth.svelte";
import { chipTitle } from "../../lib/ai/picker";
import { authLabel, isReady, notReadyNote, type OAuthStatus } from "../../lib/ai/types";
import { mkProvider } from "./fixtures";

function status(over: Partial<OAuthStatus> = {}): OAuthStatus {
  return { provider: "open_ai", available: true, docsUrl: "d", flow: "loopback", signedIn: false, pending: false, planUsage: false, models: [], authMode: "subscription", fallbackToKey: false, ...over };
}

const emit = (payload: unknown) => oauthHandler?.({ payload });

describe("reduceFlow", () => {
  it("walks idle -> starting -> waiting -> signed_in", () => {
    let s: FlowState = initialFlow();
    s = reduceFlow(s, { type: "start" });
    expect(s.phase).toBe("starting");
    s = reduceFlow(s, { type: "started", start: { flow: "loopback", authUrl: "https://auth/x", browserFailed: false } });
    expect(s.phase).toBe("waiting");
    expect(s.start?.authUrl).toBe("https://auth/x");
    s = reduceFlow(s, { type: "event", ev: { provider: "open_ai", state: "signed_in", email: "me@x.y" } });
    expect(s.phase).toBe("signed_in");
    expect(s.email).toBe("me@x.y");
    expect(s.start).toBeUndefined();
  });

  it("errors are shown, cancels are not, and a late `started` never undoes a final state", () => {
    let s = reduceFlow(initialFlow(), { type: "start" });
    s = reduceFlow(s, { type: "event", ev: { provider: "open_ai", state: "error", code: "ai_oauth_state_mismatch", error: "state mismatch" } });
    expect(s.phase).toBe("error");
    expect(s.code).toBe("ai_oauth_state_mismatch");
    s = reduceFlow(s, { type: "started", start: { flow: "loopback", authUrl: "u", browserFailed: false } });
    expect(s.phase).toBe("error");
    let c = reduceFlow(initialFlow(), { type: "start" });
    c = reduceFlow(c, { type: "event", ev: { provider: "open_ai", state: "error", code: "ai_oauth_cancelled" } });
    expect(c.phase).toBe("idle");
    expect(c.error).toBeUndefined();
  });

  it("status resyncs: pending -> waiting, signed in -> signed_in, signed_out -> idle", () => {
    expect(reduceFlow(initialFlow(), { type: "status", status: status({ pending: true }) }).phase).toBe("waiting");
    const signed = reduceFlow(initialFlow(), { type: "status", status: status({ signedIn: true, email: "a@b.c", images: { eligible: false, detail: "docs", source: "docs", checkedAt: 1 } }) });
    expect(signed.phase).toBe("signed_in");
    expect(signed.email).toBe("a@b.c");
    expect(signed.images?.source).toBe("docs");
    expect(reduceFlow(signed, { type: "event", ev: { provider: "open_ai", state: "signed_out" } }).phase).toBe("idle");
    // A status poll during a flow keeps the flow phase.
    const waiting = reduceFlow(reduceFlow(initialFlow(), { type: "start" }), { type: "status", status: status() });
    expect(waiting.phase).toBe("starting");
  });
});

describe("oauthStore (mocked invoke / listen)", () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    oauthStore.reset();
    invoke.mockReset();
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "ai_oauth_start":
          // Rust emits `waiting` before returning.
          emit({ provider: args?.provider, state: "waiting" });
          return args?.provider === "x_ai"
            ? { flow: "device", authUrl: "https://accounts.x.ai/device?user_code=WDJB-MJHT", userCode: "WDJB-MJHT", verificationUri: "https://accounts.x.ai/device", expiresIn: 600, browserFailed: false }
            : { flow: "loopback", authUrl: "https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client", browserFailed: false };
        case "ai_oauth_status":
          return status({ signedIn: true, email: "paul@example.com", models: [{ slug: "gpt-5.5", displayName: "GPT-5.5" }] });
        case "ai_oauth_cancel":
          return true;
        case "ai_oauth_sign_out":
          return status({ signedIn: false });
        case "ai_oauth_check_images":
          return args?.live ? { eligible: false, detail: "Your ChatGPT plan can't generate images", source: "live", checkedAt: 2 } : { eligible: false, detail: "Preview limitations lists image generation", source: "docs", checkedAt: 1 };
        case "ai_auth_configure":
          return status({ authMode: (args?.mode as "api_key" | "subscription") ?? "subscription", fallbackToKey: Boolean(args?.fallbackToKey) });
        case "ai_list_providers":
          return [mkProvider("open_ai", { authModes: ["api_key", "subscription"], authActive: "subscription", account: { email: "paul@example.com" }, promptAssist: true })];
        default:
          return null;
      }
    });
  });
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it("start listens first, then waits, and the signed_in event refreshes status", async () => {
    await oauthStore.start("open_ai");
    expect(invoke).toHaveBeenCalledWith("ai_oauth_start", { provider: "open_ai" });
    expect(oauthStore.flow("open_ai").phase).toBe("waiting");
    expect(oauthStore.flow("open_ai").start?.authUrl).toContain("dynamic_agent_client");
    emit({ provider: "open_ai", state: "signed_in", email: "paul@example.com" });
    expect(oauthStore.flow("open_ai").phase).toBe("signed_in");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("ai_oauth_status", { provider: "open_ai" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("ai_list_providers"));
  });

  it("device flow keeps the user code; cancel returns to idle", async () => {
    await oauthStore.start("x_ai");
    expect(oauthStore.flow("x_ai").start?.userCode).toBe("WDJB-MJHT");
    await oauthStore.cancel("x_ai");
    expect(invoke).toHaveBeenCalledWith("ai_oauth_cancel", { provider: "x_ai" });
    expect(oauthStore.flow("x_ai").phase).toBe("idle");
  });

  it("start failures surface the typed error", async () => {
    invoke.mockImplementationOnce(async () => {
      throw { code: "ai_oauth_unavailable", message: "Sign in with SuperGrok is awaiting xAI approval for Pixelforge" };
    });
    await oauthStore.start("x_ai");
    const f = oauthStore.flow("x_ai");
    expect(f.phase).toBe("error");
    expect(f.code).toBe("ai_oauth_unavailable");
    expect(f.error).toContain("awaiting xAI approval");
  });

  it("check images (docs, then opt-in live), configure and sign out", async () => {
    const docs = await oauthStore.checkImages("open_ai");
    expect(docs?.source).toBe("docs");
    expect(invoke).toHaveBeenCalledWith("ai_oauth_check_images", { provider: "open_ai", live: false });
    await oauthStore.checkImages("open_ai", true);
    expect(invoke).toHaveBeenCalledWith("ai_oauth_check_images", { provider: "open_ai", live: true });
    expect(oauthStore.flow("open_ai").images?.source).toBe("live");
    const st = await oauthStore.configure("open_ai", { fallbackToKey: true });
    expect(invoke).toHaveBeenCalledWith("ai_auth_configure", { provider: "open_ai", fallbackToKey: true });
    expect(st?.fallbackToKey).toBe(true);
    await oauthStore.signOut("open_ai");
    expect(oauthStore.flow("open_ai").phase).toBe("idle");
    expect(oauthStore.flow("open_ai").status?.signedIn).toBe(false);
  });
});

describe("dialog / picker logic", () => {
  it("authItems: ChatGPT and Grok offer both, Gemini none", () => {
    expect(authItems("open_ai").map((i) => i.label)).toEqual(["API key", "ChatGPT subscription"]);
    expect(authItems("x_ai")[1]?.label).toBe("SuperGrok subscription");
    expect(authItems("gemini")).toEqual([]);
  });

  it("subscriptionView picks the right panel", () => {
    expect(subscriptionView(initialFlow(), status({ available: false, provider: "x_ai", flow: "device" }))).toBe("unavailable");
    expect(subscriptionView(initialFlow(), status())).toBe("signin");
    expect(subscriptionView({ phase: "waiting" }, status())).toBe("waiting");
    expect(subscriptionView(initialFlow(), status({ signedIn: true }))).toBe("signed_in");
    expect(authModeOf(undefined, mkProvider("open_ai", { authActive: "subscription" }))).toBe("subscription");
    expect(authModeOf(status({ authMode: "api_key" }), mkProvider("open_ai", { authActive: "subscription" }))).toBe("api_key");
    expect(authModeOf(undefined, undefined)).toBe("api_key");
  });

  it("labels and readiness follow the auth mode", () => {
    const keyMode = mkProvider("open_ai", { name: "ChatGPT", authModes: ["api_key", "subscription"], authActive: "api_key", hasKey: false });
    expect(authLabel(keyMode)).toBe("ChatGPT (API key)");
    expect(isReady(keyMode)).toBe(false);
    expect(notReadyNote(keyMode)).toBe("no key");
    const sub = { ...keyMode, authActive: "subscription" as const };
    expect(authLabel(sub)).toBe("ChatGPT (subscription)");
    expect(isReady(sub)).toBe(false);
    expect(notReadyNote(sub)).toBe("not signed in");
    expect(chipTitle(sub)).toContain("not signed in");
    const signed = { ...sub, account: { email: "me@x.y" } };
    expect(isReady(signed)).toBe(true);
    expect(chipTitle(signed)).toContain("me@x.y");
    expect(authLabel(mkProvider("gemini", { name: "Gemini" }))).toBe("Gemini");
  });

  it("friendly errors for the plan codes", () => {
    const ne = describeAiError("ai_plan_not_eligible", "Your ChatGPT plan can't generate images through third-party apps — use an API key for images.");
    expect(ne.title).toContain("subscription can't do this");
    expect(ne.hint).toContain("use an API key for images");
    expect(ne.retryable).toBe(false);
    const lim = describeAiError("ai_plan_limit", "Your ChatGPT plan's usage limit for Pixelforge is reached; it resets 2026-10-07 13:33 UTC.");
    expect(lim.title).toContain("usage limit");
    expect(lim.hint).toContain("resets 2026-10-07");
    expect(describeAiError("ai_oauth_reauth", "x").title).toContain("signed out");
    expect(describeAiError("ai_oauth_state_mismatch", "x").hint).toContain("Nothing was exchanged");
  });
});
