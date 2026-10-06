/**
 * TypeScript mirror of the AI IPC contract (`docs/ipc.md`, `crates/pf-ai/src/ipc.rs`,
 * `app/src-tauri/src/commands/ai.rs`). Field names are the camelCase wire names.
 */

export type ProviderId = "open_ai" | "x_ai" | "gemini";
export type EditMode = "mask" | "instruct";

/** Which of the three AI workflows a request runs (`mask` and `instruct` are edits). */
export type AiMode = "generate" | "mask" | "instruct";

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
  /** Short label used in layer names: `ChatGPT`, `Grok`, `Gemini`. */
  name: string;
  /** `OpenAI`, `xAI`, `Google`. */
  vendor: string;
  capabilities: Capabilities;
  hasKey: boolean;
  keyBackend: "keyring" | "file";
  defaultModel: string;
  editModel: string;
  models: string[];
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

export type KeyStatus = Record<ProviderId, boolean>;

export const PROVIDER_IDS: readonly ProviderId[] = ["open_ai", "x_ai", "gemini"];

/** Display names used when the provider list has not been fetched yet. */
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  open_ai: "ChatGPT",
  x_ai: "Grok",
  gemini: "Gemini",
};

export const PROVIDER_VENDOR: Record<ProviderId, string> = {
  open_ai: "OpenAI",
  x_ai: "xAI",
  gemini: "Google",
};

/** Where to get a key for each provider. */
export const PROVIDER_CONSOLE_URL: Record<ProviderId, string> = {
  open_ai: "https://platform.openai.com/api-keys",
  x_ai: "https://console.x.ai",
  gemini: "https://aistudio.google.com/apikey",
};
