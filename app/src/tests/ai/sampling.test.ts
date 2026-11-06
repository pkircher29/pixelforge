import { expect, it } from "vitest";
import { aiUi } from "../../lib/ai/ui.svelte";
import { validateSampling } from "../../lib/ai/sampling";
import type { ProviderInfo } from "../../lib/ai/types";
import { mkProvider } from "./fixtures";

it("retains independent controls per provider and hides them for built-ins", () => {
  const before = { providers: aiUi.providers, providerId: aiUi.providerId };
  const sd = mkProvider("custom:sd", { kind: "a1111" });
  const comfy = mkProvider("custom:comfy", { kind: "comfy_ui" });
  const builtin = mkProvider("open_ai");
  try {
    aiUi.providers = [sd, comfy, builtin];
    aiUi.providerId = sd.id; aiUi.setSampling("seed", 0); aiUi.setSampling("steps", 25);
    aiUi.providerId = comfy.id; expect(aiUi.sampling).toEqual({}); aiUi.setSampling("seed", 42);
    aiUi.providerId = builtin.id; expect(aiUi.sampling).toEqual({});
    aiUi.providerId = sd.id; expect(aiUi.sampling).toEqual({ seed: 0, steps: 25 });
    aiUi.setSampling("seed", undefined); expect(aiUi.sampling.seed).toBeUndefined();
    aiUi.providerId = comfy.id; expect(aiUi.sampling).toEqual({ seed: 42 });
  } finally {
    aiUi.providers = before.providers; aiUi.providerId = before.providerId; aiUi.samplingByProvider = {};
  }
});

it.each([NaN, Infinity, -1, 0.5, 2147483648])("rejects invalid seed %s", (seed) => {
  expect(() => validateSampling({ kind: "a1111" } as ProviderInfo, { seed })).toThrow("Seed");
});
