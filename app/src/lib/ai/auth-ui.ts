/**
 * Pure view logic for the "Authentication" part of AI Providers (tested in
 * `tests/ai/oauth.test.ts`): which modes a provider offers, which subscription panel to
 * show, and the documentation links the frank notes cite.
 */

import type { FlowState } from "./oauth.svelte";
import type { AuthMode, BuiltinProviderId, OAuthStatus, ProviderInfo } from "./types";

/** OpenAI page that lists image generation as unavailable on plan usage. */
export const LIMITATIONS_URL = "https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations";
/** Our write-up of xAI's status and the application route. */
export const XAI_RESEARCH_URL = "https://github.com/pkircher29/pixelforge/blob/main/docs/ai-research.md#5-subscription-sign-in-verified-2026-10-06";
/** Google's statement that AI Pro / Ultra do not cover the Gemini API. */
export const GEMINI_PLANS_URL = "https://ai.google.dev/gemini-api/docs/google-ai-plans";

export interface SegItem {
  value: AuthMode;
  label: string;
  title: string;
}

/** Segmented items: Gemini gets none (no subscription sign-in exists). */
export function authItems(id: BuiltinProviderId): SegItem[] {
  if (id === "gemini") return [];
  const sub = id === "open_ai" ? "ChatGPT subscription" : "SuperGrok subscription";
  return [
    { value: "api_key", label: "API key", title: "Use your own API key (billed by the vendor per request)" },
    { value: "subscription", label: sub, title: id === "open_ai" ? "Sign in with ChatGPT and use your plan (text only; images need a key)" : "Sign in with SuperGrok / X Premium (needs an xAI-issued client ID)" },
  ];
}

/** Active mode: the fresh status wins, then the provider list, then API key. */
export function authModeOf(status: OAuthStatus | undefined, info: ProviderInfo | undefined): AuthMode {
  return status?.authMode ?? info?.authActive ?? "api_key";
}

export type SubscriptionView = "unavailable" | "signin" | "waiting" | "signed_in";

/** Which subscription panel to render. */
export function subscriptionView(flow: FlowState, status: OAuthStatus | undefined): SubscriptionView {
  if (status && !status.available && !status.signedIn) return "unavailable";
  if (flow.phase === "waiting" || flow.phase === "starting") return "waiting";
  if (flow.phase === "signed_in" || status?.signedIn) return "signed_in";
  return "signin";
}
