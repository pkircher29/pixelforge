/**
 * Custom provider registry store (`ai_custom_*` commands) plus the derived views the
 * AI panel needs over `aiUi.providers` (which stays the single `ProviderInfo[]` source:
 * every mutation here re-fetches it so chips, the shootout checklist and the dialog agree).
 *
 * Tested with a mocked `invoke` in `tests/ai/providers.test.ts`.
 */

import {
  addCustomProvider,
  hasTauri,
  listCustomKinds,
  listCustomProviders,
  probeCustomProvider,
  removeCustomProvider,
  updateCustomProvider,
} from "./client";
import { toFriendlyError } from "./errors";
import { aiUi } from "./ui.svelte";
import {
  CUSTOM_KINDS,
  canGenerate,
  isReady,
  type Capabilities,
  type CustomKind,
  type CustomKindInfo,
  type CustomProvider,
  type ProbeResult,
  type ProviderId,
  type ProviderInfo,
} from "./types";

/** Offline fallback for the kind table (mirrors `CustomKind::*` in Rust). */
export const KIND_FALLBACK: CustomKindInfo[] = [
  { kind: "openai_compat", label: "OpenAI-compatible server", description: "OpenAI-compatible server (LocalAI, LM Studio, vLLM, or any vendor)", defaultBaseUrl: "http://localhost:8080", helpUrl: "https://localai.io/docs/features/image-generation/", requiresAuth: false, promptAssist: false, defaultCapabilities: caps({ generate: true, maxPx: 4096 }) },
  { kind: "hugging_face", label: "Hugging Face", description: "Hugging Face (Inference API / Endpoint)", defaultBaseUrl: "https://router.huggingface.co/hf-inference", helpUrl: "https://huggingface.co/settings/tokens", requiresAuth: true, promptAssist: false, defaultCapabilities: caps({ generate: true }) },
  { kind: "ollama", label: "Ollama", description: "Ollama (local, prompt assist)", defaultBaseUrl: "http://localhost:11434", helpUrl: "https://ollama.com", requiresAuth: false, promptAssist: true, defaultCapabilities: caps({}) },
  { kind: "comfy_ui", label: "ComfyUI", description: "ComfyUI (local, full control, inpainting)", defaultBaseUrl: "http://127.0.0.1:8188", helpUrl: "https://github.com/comfyanonymous/ComfyUI", requiresAuth: false, promptAssist: false, defaultCapabilities: caps({ generate: true, instructEdit: true, maskEdit: true }) },
  { kind: "a1111", label: "Stable Diffusion WebUI / Forge", description: "Stable Diffusion WebUI / Forge (local, inpainting)", defaultBaseUrl: "http://127.0.0.1:7860", helpUrl: "https://github.com/AUTOMATIC1111/stable-diffusion-webui", requiresAuth: false, promptAssist: false, defaultCapabilities: caps({ generate: true, instructEdit: true, maskEdit: true }) },
  { kind: "replicate", label: "Replicate", description: "Replicate (hosted, any public model)", defaultBaseUrl: "https://api.replicate.com", helpUrl: "https://replicate.com/account/api-tokens", requiresAuth: true, promptAssist: false, defaultCapabilities: caps({ generate: true, maxPx: 4096 }) },
];

function caps(over: Partial<Capabilities>): Capabilities {
  return {
    generate: false,
    maskEdit: false,
    instructEdit: false,
    multiRef: false,
    maxRefs: 1,
    sizes: [],
    customSizes: true,
    aspectRatios: [],
    resolutions: [],
    maxPx: 2048,
    maxVariants: 4,
    transparentBg: false,
    models: [],
    ...over,
  };
}

/** A blank entry for the "+ Add" menu. */
export function newCustomProvider(kind: CustomKind, kinds: CustomKindInfo[] = KIND_FALLBACK): CustomProvider {
  const info = kinds.find((k) => k.kind === kind) ?? KIND_FALLBACK.find((k) => k.kind === kind)!;
  return { id: "", name: info.label, kind, baseUrl: info.defaultBaseUrl, model: "", capabilities: { ...info.defaultCapabilities }, extra: {}, hasAuth: false };
}

/** `"My ComfyUI"` -> `my-comfyui`, unique against `taken`. */
export function slugify(name: string, taken: readonly string[] = []): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!base) base = "provider";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

class ProvidersStore {
  /** Registry entries (no secrets). */
  custom = $state<CustomProvider[]>([]);
  kinds = $state<CustomKindInfo[]>(KIND_FALLBACK);
  loaded = $state(false);
  error = $state<string | null>(null);
  /** The kind table came from Rust (not the offline fallback). */
  private kindsLoaded = false;
  /** Last probe per entry id (for the status column). */
  probes = $state<Record<string, ProbeResult>>({});

  /** Everything the panel knows (built-ins first, then custom in registry order). */
  get all(): ProviderInfo[] {
    return aiUi.providers;
  }

  /** Providers that can make images (chips, shootout). */
  get generators(): ProviderInfo[] {
    return aiUi.providers.filter(canGenerate);
  }

  /** Providers that can rewrite prompts (Ollama). */
  get assistants(): ProviderInfo[] {
    return aiUi.providers.filter((p) => p.promptAssist);
  }

  /** Generators that have what they need to run right now. */
  get ready(): ProviderInfo[] {
    return this.generators.filter(isReady);
  }

  byId(id: ProviderId): ProviderInfo | undefined {
    return aiUi.providers.find((p) => p.id === id);
  }

  kindInfo(kind: CustomKind): CustomKindInfo {
    return this.kinds.find((k) => k.kind === kind) ?? KIND_FALLBACK.find((k) => k.kind === kind)!;
  }

  async refresh(): Promise<void> {
    if (!hasTauri()) {
      this.loaded = true;
      return;
    }
    try {
      const [custom, kinds] = await Promise.all([listCustomProviders(), this.kindsLoaded ? Promise.resolve(null) : listCustomKinds()]);
      this.custom = custom;
      if (kinds && kinds.length === CUSTOM_KINDS.length) {
        this.kinds = kinds;
        this.kindsLoaded = true;
      }
      this.error = null;
    } catch (e) {
      this.error = toFriendlyError(e).title;
    } finally {
      this.loaded = true;
    }
    await aiUi.refreshProviders();
  }

  private apply(list: CustomProvider[]): void {
    this.custom = list;
    this.error = null;
    void aiUi.refreshProviders();
  }

  async add(provider: CustomProvider, auth?: string): Promise<CustomProvider[]> {
    const list = await addCustomProvider(provider, auth);
    this.apply(list);
    return list;
  }

  async update(provider: CustomProvider, auth?: string, clearAuth = false): Promise<CustomProvider[]> {
    const list = await updateCustomProvider(provider, auth, clearAuth);
    this.apply(list);
    return list;
  }

  async remove(id: string): Promise<CustomProvider[]> {
    const list = await removeCustomProvider(id);
    const probes = { ...this.probes };
    delete probes[id];
    this.probes = probes;
    this.apply(list);
    return list;
  }

  /** Probe (unsaved values allowed). The result is remembered per id. */
  async probe(provider: CustomProvider, auth?: string): Promise<ProbeResult> {
    const result = await probeCustomProvider(provider, auth);
    if (provider.id) this.probes = { ...this.probes, [provider.id]: result };
    return result;
  }

  /** Inject state (demo / tests). */
  setCustom(list: CustomProvider[]): void {
    this.custom = list;
    this.loaded = true;
  }
}

export const providersStore = new ProvidersStore();
