import { describe, expect, it } from "vitest";
import { describeAiError, parseCategories, parseRetryAfter, toFriendlyError } from "../../lib/ai/errors";
import { estimateCost, formatUsd, geminiTier } from "../../lib/ai/pricing";

describe("describeAiError", () => {
  it("ai_auth points at Settings", () => {
    const e = describeAiError("ai_auth", "401 Unauthorized");
    expect(e.hint).toMatch(/Settings/);
    expect(e.retryable).toBe(false);
  });

  it("ai_rate_limited extracts Retry-After in seconds or minutes", () => {
    expect(describeAiError("ai_rate_limited", "429; Retry-After: 12").retryAfterSecs).toBe(12);
    expect(describeAiError("ai_rate_limited", "please retry after 2 minutes").retryAfterSecs).toBe(120);
    expect(describeAiError("ai_rate_limited", "slow down").retryAfterSecs).toBeUndefined();
    expect(parseRetryAfter("Retry-After=5s")).toBe(5);
  });

  it("ai_moderation_blocked lists categories", () => {
    const e = describeAiError("ai_moderation_blocked", 'moderation_blocked: categories: ["violence", "self-harm"]');
    expect(e.categories).toEqual(["violence", "self-harm"]);
    expect(e.hint).toMatch(/violence/);
    expect(parseCategories("blocked for safety")).toBeUndefined();
  });

  it("ai_timeout is retryable and mentions Advanced", () => {
    const e = describeAiError("ai_timeout", "deadline of 180 s hit");
    expect(e.retryable).toBe(true);
    expect(e.hint).toMatch(/Advanced/);
  });

  it("unknown codes fall back to the raw message; toFriendlyError coerces anything", () => {
    expect(describeAiError("weird", "boom").title).toBe("boom");
    expect(toFriendlyError({ code: "ai_cancelled", message: "x" }).code).toBe("ai_cancelled");
    expect(toFriendlyError(new Error("js fail")).detail).toBe("js fail");
    expect(toFriendlyError("str").detail).toBe("str");
  });
});

describe("estimateCost", () => {
  it("xAI flat rate, doubled for edits, times n", () => {
    expect(estimateCost({ provider: "x_ai", model: "grok-imagine-image-2.0", mode: "generate", n: 3 }).usd).toBeCloseTo(0.12);
    const edit = estimateCost({ provider: "x_ai", model: "grok-imagine-image-2.0", mode: "instruct", n: 1 });
    expect(edit.usd).toBeCloseTo(0.08);
    expect(edit.approx).toBe(true);
    expect(estimateCost({ provider: "x_ai", model: "grok-imagine-image", mode: "generate", n: 1 }).usd).toBeCloseTo(0.02);
  });

  it("Gemini tiers by longest edge", () => {
    expect(geminiTier({ width: 512, height: 512 })).toBe("512");
    expect(geminiTier({ width: 1024, height: 768 })).toBe("1K");
    expect(geminiTier({ width: 2048, height: 1152 })).toBe("2K");
    expect(geminiTier({ width: 4096, height: 4096 })).toBe("4K");
    expect(estimateCost({ provider: "gemini", model: "gemini-3.1-flash-image", mode: "generate", n: 1, size: { width: 2048, height: 2048 } }).usd).toBeCloseTo(0.101);
    expect(estimateCost({ provider: "gemini", model: "gemini-3-pro-image", mode: "generate", n: 1, size: { width: 4096, height: 2304 } }).usd).toBeCloseTo(0.24);
    expect(estimateCost({ provider: "gemini", model: "gemini-3.1-flash-lite-image", mode: "generate", n: 2 }).usd).toBeCloseTo(0.0672);
  });

  it("OpenAI uses the gpt-image-2 table and flags 2.5 as approximate", () => {
    const g2 = estimateCost({ provider: "open_ai", model: "gpt-image-2", mode: "generate", n: 1, quality: "high", size: { width: 1024, height: 1024 } });
    expect(g2.usd).toBeCloseTo(0.211);
    expect(g2.approx).toBe(false);
    const g25 = estimateCost({ provider: "open_ai", model: "gpt-image-2.5-flare", mode: "generate", n: 1, quality: "low" });
    expect(g25.usd).toBeCloseTo(0.006);
    expect(g25.approx).toBe(true);
    const xhigh = estimateCost({ provider: "open_ai", model: "gpt-image-2.5-sunburst", mode: "generate", n: 1, quality: "xhigh" });
    expect(xhigh.usd).toBeGreaterThan(0.211);
    const edit = estimateCost({ provider: "open_ai", model: "gpt-image-2.5-sunburst", mode: "mask", n: 1, quality: "medium" });
    expect(edit.usd).toBeCloseTo(0.063);
    expect(estimateCost({ provider: "open_ai", model: "gpt-image-1-mini", mode: "generate", n: 1 }).usd).toBeCloseTo(0.005);
  });

  it("formatUsd", () => {
    expect(formatUsd(0.04)).toBe("$0.04");
    expect(formatUsd(0.006, true)).toBe("~$0.006");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
