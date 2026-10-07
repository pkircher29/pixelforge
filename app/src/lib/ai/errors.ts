/**
 * Turn the typed `{ code, message }` errors of `docs/ipc.md` into something a person can
 * act on. Pure; tested in `tests/ai/errors.test.ts`.
 */

import { isCommandError } from "./types";

export interface FriendlyError {
  code: string;
  /** One line, sentence case, says what happened. */
  title: string;
  /** What to do about it; empty when nothing helps. */
  hint: string;
  /** Worth a "Retry" button. */
  retryable: boolean;
  /** Seconds to wait, when the provider said so (`ai_rate_limited`). */
  retryAfterSecs?: number;
  /** Moderation categories, when the provider listed them. */
  categories?: string[];
  /** The raw provider message, for the details disclosure. */
  detail: string;
}

/** Pull `Retry-After: 20` / `retry after 20s` / `20 seconds` out of a message. */
export function parseRetryAfter(message: string): number | undefined {
  const m = /retry[\s-]*after\D{0,4}(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|minutes)?/i.exec(message);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (m[2] ?? "s").toLowerCase();
  return unit.startsWith("m") ? Math.round(n * 60) : Math.round(n);
}

/** Pull `categories: [a, b]` / `categories: a, b` / `"categories":["a"]` out of a message. */
export function parseCategories(message: string): string[] | undefined {
  const m = /categor(?:y|ies)\W{0,4}\[?([^\]\n]+?)\]?(?:[.;)]|$)/i.exec(message);
  if (!m) return undefined;
  const list = m[1]!
    .split(/[,/]/)
    .map((s) => s.replace(/["'`]/g, "").trim())
    .filter((s) => s.length > 0 && s.length < 48);
  return list.length > 0 ? list : undefined;
}

export function describeAiError(code: string, message: string): FriendlyError {
  const base = { code, detail: message };
  switch (code) {
    case "ai_not_configured":
      return { ...base, title: "No API key for this provider.", hint: "Add your key in Settings > AI Providers (Edit menu).", retryable: false };
    case "ai_auth":
      return { ...base, title: "The provider rejected the API key.", hint: "Add your key in Settings > AI Providers (Edit menu) and test it.", retryable: false };
    case "ai_rate_limited": {
      const retryAfterSecs = parseRetryAfter(message);
      return {
        ...base,
        title: "Rate limited by the provider.",
        hint: retryAfterSecs ? `Try again in about ${retryAfterSecs} s.` : "Wait a moment and try again.",
        retryable: true,
        ...(retryAfterSecs !== undefined ? { retryAfterSecs } : {}),
      };
    }
    case "ai_moderation_blocked": {
      const categories = parseCategories(message);
      return {
        ...base,
        title: "Blocked by the provider's safety filter.",
        hint: categories ? `Flagged: ${categories.join(", ")}. Change the prompt or the image.` : "Change the prompt or the image.",
        retryable: false,
        ...(categories ? { categories } : {}),
      };
    }
    case "ai_timeout":
      return { ...base, title: "The job hit its time limit.", hint: "Try again, or raise the timeout under Advanced.", retryable: true };
    case "ai_cancelled":
      return { ...base, title: "Cancelled.", hint: "", retryable: true };
    case "ai_transport":
      return { ...base, title: "Could not reach the provider.", hint: "Check the network connection and try again.", retryable: true };
    case "ai_http":
      return { ...base, title: "The provider returned an error.", hint: "Usually temporary; try again.", retryable: true };
    case "ai_bad_request":
      return { ...base, title: "The provider rejected the request.", hint: "Check the size, model and prompt.", retryable: false };
    case "ai_invalid_request":
      return { ...base, title: "The request breaks a provider limit.", hint: message, retryable: false };
    case "ai_unsupported":
      return { ...base, title: "This provider cannot do that.", hint: "Pick another provider.", retryable: false };
    case "ai_invalid_response":
      return { ...base, title: "The provider sent back no usable image.", hint: "Try again; if it persists, try another model.", retryable: true };
    case "ai_image":
      return { ...base, title: "Could not encode or decode an image.", hint: "Check the input image.", retryable: false };
    case "ai_plan_not_eligible":
      return { ...base, title: "Your subscription can't do this through Pixelforge.", hint: message || "Switch this provider to an API key in AI Providers.", retryable: false };
    case "ai_plan_limit":
      return { ...base, title: "Your subscription's usage limit is reached.", hint: message || "Wait for the limit to reset, or switch to an API key.", retryable: false };
    case "ai_oauth_signed_out":
    case "ai_oauth_reauth":
      return { ...base, title: "You're signed out of your subscription.", hint: "Sign in again in AI Providers (Edit menu), or switch to an API key.", retryable: false };
    case "ai_oauth_unavailable":
      return { ...base, title: "Subscription sign-in isn't available for this provider.", hint: message, retryable: false };
    case "ai_oauth_denied":
      return { ...base, title: "Sign-in was declined.", hint: "Start again if that wasn't intended.", retryable: true };
    case "ai_oauth_timeout":
      return { ...base, title: "Sign-in timed out.", hint: "Start again and finish in the browser within 5 minutes.", retryable: true };
    case "ai_oauth_state_mismatch":
      return { ...base, title: "The sign-in response didn't match this request.", hint: "Nothing was exchanged. Start again.", retryable: true };
    case "ai_oauth_cancelled":
      return { ...base, title: "Sign-in cancelled.", hint: "", retryable: true };
    case "ai_oauth_callback":
    case "ai_oauth_exchange":
    case "ai_oauth_id_token":
    case "ai_oauth_client":
      return { ...base, title: "Sign-in failed.", hint: message, retryable: true };
    case "ai_unknown_job":
    case "ai_no_result":
      return { ...base, title: "The job result is gone.", hint: "Run it again.", retryable: true };
    default:
      return { ...base, title: message || "Something went wrong.", hint: "", retryable: false };
  }
}

/** Coerce anything thrown by `invoke` into a friendly error. */
export function toFriendlyError(e: unknown): FriendlyError {
  if (isCommandError(e)) return describeAiError(e.code, e.message);
  if (e instanceof Error) return describeAiError("js", e.message);
  return describeAiError("unknown", String(e));
}
