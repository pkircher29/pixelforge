/**
 * Cost estimates from the price tables in `docs/ai-research.md` (verified 2026-10-06).
 * Estimates only: OpenAI 2.5 is token-billed and has no per-image table, xAI bills
 * edits for input + output, Gemini bills by output tier. Shown as "~$0.04".
 */

import type { AiMode, ImageSize, ProviderId } from "./types";

export interface CostEstimate {
  /** Total for `n` images. */
  usd: number;
  /** Per image. */
  perImage: number;
  /** True when the number is extrapolated rather than read from a published table. */
  approx: boolean;
  /** Short note for the tooltip. */
  note: string;
}

export interface CostQuery {
  provider: ProviderId;
  model: string;
  mode: AiMode;
  size?: ImageSize | undefined;
  quality?: string | undefined;
  n: number;
}

/** OpenAI per-image prices at 1024x1024 by quality tier (gpt-image-2 guide table). */
const OPENAI_1024: Record<string, number> = { low: 0.006, medium: 0.053, high: 0.211 };
/** gpt-image-1.5 / gpt-image-1 model-card midpoints. */
const OPENAI_LEGACY_1024: Record<string, number> = { low: 0.011, medium: 0.042, high: 0.167 };

function openAiPerImage(model: string, quality: string | undefined, size: ImageSize | undefined): { usd: number; approx: boolean; note: string } {
  const q = quality === "auto" || !quality ? "medium" : quality;
  const legacy = model.startsWith("gpt-image-1");
  const table = legacy ? OPENAI_LEGACY_1024 : OPENAI_1024;
  let base: number;
  let approx = false;
  let note: string;
  if (model === "gpt-image-1-mini") {
    base = 0.005;
    note = "gpt-image-1-mini is low quality only.";
  } else if (q === "xhigh" || q === "max") {
    base = OPENAI_1024.high! * (q === "xhigh" ? 2 : 3);
    approx = true;
    note = `${q} is 2.5-only and token-billed ($30/M output tokens); extrapolated from the high tier.`;
  } else {
    base = table[q] ?? table.medium!;
    note = legacy ? `${model} model-card midpoint at ${q} quality.` : "gpt-image-2 per-image guide table.";
    if (!legacy && model.startsWith("gpt-image-2.5")) {
      approx = true;
      note = "gpt-image-2.5 is token-billed ($30/M image output); gpt-image-2 table used as a proxy.";
    }
  }
  // Scale with output pixel count (token-billed models grow roughly linearly).
  const px = size ? size.width * size.height : 1024 * 1024;
  const scale = Math.max(0.5, px / (1024 * 1024));
  if (size && Math.abs(scale - 1) > 0.01) approx = true;
  return { usd: base * scale, approx, note };
}

function xAiPerImage(model: string, mode: AiMode): { usd: number; approx: boolean; note: string } {
  const flat = model === "grok-imagine-image" ? 0.02 : model === "grok-imagine-image-quality" ? 0.05 : 0.04;
  if (mode === "generate") return { usd: flat, approx: false, note: `xAI flat rate $${flat.toFixed(2)} per image.` };
  return { usd: flat * 2, approx: true, note: "xAI bills edits for the input image and the output image." };
}

/** Gemini output tier from the longest edge. */
export function geminiTier(size: ImageSize | undefined): "512" | "1K" | "2K" | "4K" {
  const edge = size ? Math.max(size.width, size.height) : 1024;
  if (edge <= 512) return "512";
  if (edge <= 1024) return "1K";
  if (edge <= 2048) return "2K";
  return "4K";
}

function geminiPerImage(model: string, size: ImageSize | undefined): { usd: number; approx: boolean; note: string } {
  const tier = geminiTier(size);
  if (model === "gemini-3.1-flash-lite-image") return { usd: 0.0336, approx: false, note: "Gemini 3.1 Flash Lite Image, 1K only." };
  if (model === "gemini-3-pro-image") {
    const usd = tier === "4K" ? 0.24 : 0.134;
    return { usd, approx: false, note: `Gemini 3 Pro Image at ${tier}.` };
  }
  const table = { "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 } as const;
  return { usd: table[tier], approx: false, note: `Gemini 3.1 Flash Image at ${tier}. Image input adds about $0.001.` };
}

/** Estimate the cost of one request. */
export function estimateCost(q: CostQuery): CostEstimate {
  const n = Math.max(1, Math.floor(q.n));
  let per: { usd: number; approx: boolean; note: string };
  switch (q.provider) {
    case "open_ai":
      per = openAiPerImage(q.model, q.quality, q.size);
      if (q.mode !== "generate") {
        per = { usd: per.usd + 0.01, approx: true, note: `${per.note} Input image tokens add about $0.01.` };
      }
      break;
    case "x_ai":
      per = xAiPerImage(q.model, q.mode);
      break;
    case "gemini":
      per = geminiPerImage(q.model, q.size);
      break;
  }
  return { usd: per.usd * n, perImage: per.usd, approx: per.approx, note: per.note };
}

/** `~$0.04` / `$0.067` formatting. */
export function formatUsd(usd: number, approx = false): string {
  const digits = usd < 0.01 ? 3 : usd < 1 ? 2 : 2;
  return `${approx ? "~" : ""}$${usd.toFixed(digits)}`;
}
