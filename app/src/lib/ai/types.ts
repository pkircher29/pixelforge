/**
 * TypeScript mirror of the AI IPC contract (`docs/ipc.md`, `crates/pf-ai/src/ipc.rs`,
 * `app/src-tauri/src/commands/ai.rs`). Field names are the camelCase wire names.
 */

export type BuiltinProviderId = "open_ai" | "x_ai" | "gemini";
/** Custom providers are `custom:<registry id>` (see `CustomProvider`). */
export type CustomProviderId = `custom:${string}`;
export type ProviderId = BuiltinProviderId | CustomProviderId;
export type EditMode = "mask" | "instruct";

/** Which of the three AI workflows a request runs (`mask` and `instruct` are edits). */
export type AiMode = "generate" | "mask" | "instruct";

export const CUSTOM_PREFIX = "custom:";

export function isCustomProviderId(id: string): id is CustomProviderId {
  return id.startsWith(CUSTOM_PREFIX) && id.length > CUSTOM_PREFIX.length;
}

export function isProviderId(id: unknown): id is ProviderId {
  return typeof id === "string" && (id === "open_ai" || id === "x_ai" || id === "gemini" || isCustomProviderId(id));
}

/** `custom:<id>` -> `<id>`; built-ins -> null. */
export function customIdOf(id: ProviderId): string | null {
  return isCustomProviderId(id) ? id.slice(CUSTOM_PREFIX.length) : null;
}

/** Wire names of the custom provider kinds (`crates/pf-ai/src/custom.rs`). */
export type CustomKind = "openai_compat" | "hugging_face" | "ollama" | "comfy_ui" | "a1111" | "replicate";

export const CUSTOM_KINDS: readonly CustomKind[] = ["openai_compat", "hugging_face", "ollama", "comfy_ui", "a1111", "replicate"];

/** Static per-kind data from `ai_custom_kinds`. */
export interface CustomKindInfo {
  kind: CustomKind;
  label: string;
  description: string;
  defaultBaseUrl: string;
  helpUrl: string;
  requiresAuth: boolean;
  promptAssist: boolean;
  defaultCapabilities: Capabilities;
}

/**
 * One registry entry (`ai-providers.json`). The secret lives in the key store under
 * `custom:<id>`; only `hasAuth` is persisted. `extra` carries kind-specific knobs:
 * `steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `seed`, `checkpoint`, `workflow`
 * (ComfyUI, object or JSON string), `workflowImg2img`, `workflowInpaint`, `maskBlur`,
 * `inpaintingFill`, `inpaintFullRes`, `version` / `imageField` / `input` (Replicate),
 * `hubUrl` (HF tests), `models` (cached probe list).
 */
export interface CustomProvider {
  id: string;
  name: string;
  kind: CustomKind;
  baseUrl: string;
  model: string;
  capabilities: Capabilities;
  extra: Record<string, unknown>;
  hasAuth: boolean;
}

export interface ProbeResult {
  reachable: boolean;
  models: string[];
  detectedCaps?: Capabilities;
  message: string;
  version?: string;
  authFailed: boolean;
}

export interface HubModel {
  id: string;
  pipelineTag?: string;
  downloads: number;
  likes: number;
  gated: boolean;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface Capabilities {
  generate: boolean;
  maskEdit: boolean;
  instructEdit: boolean;
  multiRef: boolean;
  /** Input images per request, including the composite. */
  maxRefs: number;
  /** Presets (OpenAI); empty for aspect-driven providers. */
  sizes: ImageSize[];
  customSizes: boolean;
  aspectRatios: string[];
  resolutions: string[];
  /** Longest edge. */
  maxPx: number;
  maxVariants: number;
  transparentBg: boolean;
  /** `models[0]` is the default. */
  models: string[];
}

export interface ProviderInfo {
  id: ProviderId;
  /** Short label used in layer names: `ChatGPT`, `Grok`, `Gemini`, or the custom name. */
  name: string;
  /** `OpenAI`, `xAI`, `Google`, or the custom kind label. */
  vendor: string;
  capabilities: Capabilities;
  hasKey: boolean;
  keyBackend: "keyring" | "file";
  defaultModel: string;
  editModel: string;
  models: string[];
  /** `builtin` or a `CustomKind`. */
  kind: "builtin" | CustomKind;
  /** Runs on this machine / LAN: no cost, 🖥 glyph. */
  local: boolean;
  /** `cloud` | `local` | `hub` | `assist`. */
  icon: string;
  /** Can rewrite prompts (Ollama) but never makes images. */
  promptAssist: boolean;
  /** A secret is optional (local servers). */
  keyOptional: boolean;
}

/** Can this provider be used to make images at all (generation chips / shootout)? */
export function canGenerate(p: ProviderInfo): boolean {
  return p.capabilities.generate || p.capabilities.instructEdit || p.capabilities.maskEdit;
}

/** Ready to run: has a key, or the key is optional. */
export function isReady(p: ProviderInfo): boolean {
  return p.hasKey || p.keyOptional;
}

export type JobId = string;

export interface ImageResultMeta {
  width: number;
  height: number;
  provider: ProviderId;
  model: string;
  revisedPrompt?: string;
  costUsd?: number;
  mime: string;
  bytes: number;
}

export type JobStatus =
  | { state: "queued" }
  | { state: "running" }
  | { state: "completed"; results: ImageResultMeta[]; available: boolean }
  | { state: "failed"; code: string; message: string }
  | { state: "cancelled" };

export type JobEvent = { job: JobId; provider: ProviderId } & (
  | { type: "queued" }
  | { type: "started" }
  | { type: "progress"; pct: number | null }
  | { type: "completed"; results: ImageResultMeta[]; durationMs: number }
  | { type: "failed"; code: string; message: string }
  | { type: "cancelled" }
);

export interface GenerateParams {
  provider: ProviderId;
  prompt: string;
  negativePrompt?: string;
  size?: ImageSize;
  /** Default 1. */
  n?: number;
  model?: string;
  quality?: string;
  transparent?: boolean;
  seed?: number;
  /** 10..3600, clamped by Rust. */
  timeoutSecs?: number;
}

export interface EditParams extends GenerateParams {
  mode: EditMode;
  /** A mask blob follows the image blob. */
  mask: boolean;
  /** How many reference-image blobs follow. */
  refs: number;
}

/** Header of the `ai_take_result` frame. */
export interface ResultsHeader {
  results: ImageResultMeta[];
  blobs: number[];
  [key: string]: unknown;
}

/** `EditParams` as read back from a frame header (tests). */
export type EditFrameHeader = EditParams & { blobs: number[]; [key: string]: unknown };

/** `{ code, message }` as every Tauri command rejects with. */
export interface CommandError {
  code: string;
  message: string;
}

export function isCommandError(e: unknown): e is CommandError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/** Settings as stored by `settings_get` / `settings_set`. */
export interface Settings {
  theme: string;
  defaultProvider: ProviderId | null;
  historyBudgetMb: number;
  recentFiles: string[];
  [extra: string]: unknown;
}

export type KeyStatus = Partial<Record<ProviderId, boolean>>;

/** The three built-in providers (custom ones come from `ai_list_providers`). */
export const PROVIDER_IDS: readonly BuiltinProviderId[] = ["open_ai", "x_ai", "gemini"];

/** Display names used when the provider list has not been fetched yet. */
export const PROVIDER_LABEL: Record<BuiltinProviderId, string> = {
  open_ai: "ChatGPT",
  x_ai: "Grok",
  gemini: "Gemini",
};

export const PROVIDER_VENDOR: Record<BuiltinProviderId, string> = {
  open_ai: "OpenAI",
  x_ai: "xAI",
  gemini: "Google",
};

/** Where to get a key for each built-in provider. */
export const PROVIDER_CONSOLE_URL: Record<BuiltinProviderId, string> = {
  open_ai: "https://platform.openai.com/api-keys",
  x_ai: "https://console.x.ai",
  gemini: "https://aistudio.google.com/apikey",
};

/** Label for any provider id without a fetched list (custom ids show their registry id). */
export function providerLabel(id: ProviderId): string {
  return isCustomProviderId(id) ? id.slice(CUSTOM_PREFIX.length) : PROVIDER_LABEL[id];
}
