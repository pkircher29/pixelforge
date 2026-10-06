/**
 * Typed wrappers over the `ai_*` / `settings_*` Tauri commands (`docs/ipc.md`).
 *
 * Images cross IPC as PNG bytes inside the shared binary frame (`$lib/io/frame`):
 * encode with `encodePng` from `./png` before calling `submitEdit`. `buildEditFrame`
 * is pure so the blob order (composite, mask?, refs...) is unit-tested.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { decodeFrame, encodeFrame } from "$lib/io/frame";
import type {
  CustomKindInfo,
  CustomProvider,
  EditParams,
  GenerateParams,
  HubModel,
  ImageResultMeta,
  JobEvent,
  JobId,
  JobStatus,
  KeyStatus,
  ProbeResult,
  ProviderId,
  ProviderInfo,
  ResultsHeader,
  Settings,
} from "./types";

/** Catch-all event topic; register **before** submitting (docs/ipc.md). */
export const JOBS_EVENT = "ai://jobs";

export interface EditBlobs {
  /** PNG of the composite (or the crop when emulating a mask). */
  composite: Uint8Array;
  /** PNG, 8-bit luma convention: white = editable. Same size as `composite`. */
  mask?: Uint8Array | undefined;
  /** PNG reference images. */
  refs?: Uint8Array[] | undefined;
}

export type EditParamsInput = Omit<EditParams, "mask" | "refs">;

/** Build the `ai_submit_edit` body: header `EditParams` + blobs in the fixed order. */
export function buildEditFrame(params: EditParamsInput, blobs: EditBlobs): Uint8Array {
  if (blobs.composite.byteLength === 0) throw new Error("buildEditFrame: composite is empty");
  const refs = blobs.refs ?? [];
  const header: EditParams = { ...params, mask: blobs.mask !== undefined, refs: refs.length };
  const list: Uint8Array[] = [blobs.composite];
  if (blobs.mask) list.push(blobs.mask);
  list.push(...refs);
  return encodeFrame(header as unknown as Record<string, unknown>, list);
}

export interface TakenResult {
  meta: ImageResultMeta;
  /** PNG bytes. */
  png: Uint8Array;
}

/** Parse an `ai_take_result` frame. */
export function parseResultFrame(buf: ArrayBuffer | Uint8Array): TakenResult[] {
  const { header, blobs } = decodeFrame<ResultsHeader>(buf);
  if (!Array.isArray(header.results) || header.results.length !== blobs.length) {
    throw new Error(`ai_take_result: ${header.results?.length ?? 0} results but ${blobs.length} blobs`);
  }
  return header.results.map((meta, i) => ({ meta, png: blobs[i]! }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function listProviders(): Promise<ProviderInfo[]> {
  return invoke<ProviderInfo[]>("ai_list_providers");
}

export function submitGenerate(params: GenerateParams): Promise<JobId> {
  return invoke<JobId>("ai_submit_generate", { params });
}

export function submitEdit(params: EditParamsInput, blobs: EditBlobs): Promise<JobId> {
  return invoke<JobId>("ai_submit_edit", buildEditFrame(params, blobs));
}

export function jobStatus(job: JobId): Promise<JobStatus> {
  return invoke<JobStatus>("ai_job_status", { job });
}

export function cancelJob(job: JobId): Promise<boolean> {
  return invoke<boolean>("ai_cancel", { job });
}

export async function takeResult(job: JobId): Promise<TakenResult[]> {
  const buf = await invoke<ArrayBuffer>("ai_take_result", { job });
  return parseResultFrame(buf);
}

export function testKey(provider: ProviderId): Promise<null> {
  return invoke<null>("ai_test_key", { provider });
}

export function getKeyStatus(): Promise<KeyStatus> {
  return invoke<KeyStatus>("settings_get_key_status");
}

export function setKey(provider: ProviderId, key: string): Promise<null> {
  return invoke<null>("settings_set_key", { provider, key });
}

export function deleteKey(provider: ProviderId): Promise<null> {
  return invoke<null>("settings_delete_key", { provider });
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("settings_get");
}

export function setSettings(settings: Settings): Promise<Settings> {
  return invoke<Settings>("settings_set", { settings });
}

// ---------------------------------------------------------------------------
// Custom providers (docs/ipc.md "Custom providers")
// ---------------------------------------------------------------------------

export function listCustomKinds(): Promise<CustomKindInfo[]> {
  return invoke<CustomKindInfo[]>("ai_custom_kinds");
}

export function listCustomProviders(): Promise<CustomProvider[]> {
  return invoke<CustomProvider[]>("ai_custom_list");
}

/** `auth` (key / token / `user:pass`) is stored in the key store, never echoed back. */
export function addCustomProvider(provider: CustomProvider, auth?: string): Promise<CustomProvider[]> {
  return invoke<CustomProvider[]>("ai_custom_add", { provider, auth: auth?.trim() || null });
}

export function updateCustomProvider(provider: CustomProvider, auth?: string, clearAuth = false): Promise<CustomProvider[]> {
  return invoke<CustomProvider[]>("ai_custom_update", { provider, auth: auth?.trim() || null, clearAuth });
}

export function removeCustomProvider(id: string): Promise<CustomProvider[]> {
  return invoke<CustomProvider[]>("ai_custom_remove", { id });
}

/** Probe the entry as given (unsaved form values are fine). */
export function probeCustomProvider(provider: CustomProvider, auth?: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("ai_custom_probe", { provider, auth: auth?.trim() || null });
}

/** Frame for `ai_prompt_assist`: header `{ provider, text }` + optional image blob. */
export function buildAssistFrame(provider: ProviderId, text: string, image?: Uint8Array): Uint8Array {
  return encodeFrame({ provider, text }, image && image.byteLength > 0 ? [image] : []);
}

/** Ask an Ollama vision model to improve a prompt (optionally looking at `image`). */
export function promptAssist(provider: ProviderId, text: string, image?: Uint8Array): Promise<string> {
  return invoke<string>("ai_prompt_assist", buildAssistFrame(provider, text, image));
}

export function hubSearch(query: string, pipelineTag = "text-to-image", limit = 20): Promise<HubModel[]> {
  return invoke<HubModel[]>("ai_hub_search", { query, pipelineTag, limit });
}

/** Subscribe to every job event. Await this before the first submit. */
export function onJobEvents(handler: (ev: JobEvent) => void): Promise<UnlistenFn> {
  return listen<JobEvent>(JOBS_EVENT, (e) => handler(e.payload));
}

/** True when running inside the Tauri webview (false in vitest / plain Vite). */
export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
