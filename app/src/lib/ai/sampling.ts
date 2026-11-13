import type { ProviderInfo } from "./types";

export interface SamplingOptions {
  seed?: number | undefined;
  steps?: number | undefined;
}

export function supportsSampling(provider: ProviderInfo | null): boolean {
  return !!provider && ["openai_compat", "hugging_face", "comfy_ui", "a1111", "replicate", "fal"].includes(provider.kind);
}

/** Validate before encoding inputs, recording history or submitting a paid job. */
export function validateSampling(provider: ProviderInfo, sampling: SamplingOptions): void {
  if (sampling.seed === undefined && sampling.steps === undefined) return;
  if (!supportsSampling(provider)) throw new Error("This provider does not support seed or sampling steps.");
  if (sampling.seed !== undefined && (!Number.isInteger(sampling.seed) || sampling.seed < 0 || sampling.seed > 2147483647)) {
    throw new Error("Seed must be a whole number from 0 to 2147483647.");
  }
  if (sampling.steps !== undefined && (!Number.isInteger(sampling.steps) || sampling.steps < 1 || sampling.steps > 150)) {
    throw new Error("Steps must be a whole number from 1 to 150.");
  }
}
