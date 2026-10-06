/** Shared `ProviderInfo` / `CustomProvider` fixtures for the AI test suites. */
import type { Capabilities, CustomProvider, ProviderId, ProviderInfo } from "../../lib/ai/types";

export function caps(over: Partial<Capabilities> = {}): Capabilities {
  return {
    generate: true,
    maskEdit: false,
    instructEdit: true,
    multiRef: false,
    maxRefs: 1,
    sizes: [],
    customSizes: true,
    aspectRatios: [],
    resolutions: [],
    maxPx: 2048,
    maxVariants: 4,
    transparentBg: false,
    models: ["m"],
    ...over,
  };
}

export function mkProvider(id: ProviderId, over: Partial<ProviderInfo> = {}): ProviderInfo {
  const custom = id.startsWith("custom:");
  return {
    id,
    name: over.name ?? (custom ? id.slice(7) : id),
    vendor: custom ? "ComfyUI" : "Vendor",
    capabilities: caps(),
    hasKey: true,
    keyBackend: "file",
    defaultModel: "m",
    editModel: "m",
    models: ["m"],
    kind: custom ? "comfy_ui" : "builtin",
    local: custom,
    icon: custom ? "local" : "cloud",
    promptAssist: false,
    keyOptional: custom,
    ...over,
  };
}

export function mkCustom(id: string, over: Partial<CustomProvider> = {}): CustomProvider {
  return { id, name: id, kind: "comfy_ui", baseUrl: "http://127.0.0.1:8188", model: "x.safetensors", capabilities: caps({ maskEdit: true }), extra: {}, hasAuth: false, ...over };
}
