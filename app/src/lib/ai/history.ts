/**
 * AI history: one entry per job, persisted in `doc.meta.aiHistory` so it serialises into
 * the `.pfproj` manifest (`ai_history`, passed through opaque by `io_save_pfproj`).
 * Schema documented in `docs/ai-history.md`. Thumbnails are small data URLs (<= 160 px);
 * full inputs are never stored. Pure; tested in `tests/ai/history.test.ts`.
 */

import type { Document, Rect } from "$lib/engine";
import { isProviderId, type AiMode, type ImageSize, type ProviderId } from "./types";

export const AI_HISTORY_KEY = "aiHistory";
/** 2: custom provider ids (`custom:<id>`), `mode: "shootout"` with `subResults` / `kept`. */
export const AI_HISTORY_SCHEMA = 2;

export type AiHistoryStatus = "running" | "completed" | "failed" | "cancelled";

/** `shootout` = one prompt fanned out to several providers (`subResults`). */
export type AiHistoryMode = AiMode | "shootout";

/** One provider's outcome inside a shootout entry. */
export interface AiShootoutSubResult {
  provider: ProviderId;
  providerName: string;
  model: string;
  /** The mode this provider ran (mask may be emulated per provider). */
  mode: AiMode;
  emulated: boolean;
  status: AiHistoryStatus;
  durationMs: number;
  costUsd?: number;
  error?: { code: string; message: string };
  /** Data URL thumbnails, one per variant. */
  thumbs: string[];
}

/** A variant the user kept from a shootout. */
export interface AiShootoutKept {
  provider: ProviderId;
  /** Variant index within that provider's results. */
  index: number;
  /** `layer` = added to the document; `document` = opened as a new document. */
  as: "layer" | "document";
  layerId?: string;
  docId?: string;
}

export interface AiHistoryEntry {
  /** Unique within the document (`ai_<8 hex>`). */
  id: string;
  /** Unix ms when the job was submitted. */
  ts: number;
  /** For a shootout: the first provider that took part. */
  provider: ProviderId;
  /** `ChatGPT` / `Grok` / `Gemini` / custom name at the time of the run; "Shootout (n)" for shootouts. */
  providerName: string;
  model: string;
  mode: AiHistoryMode;
  /** Mask mode on a provider without native masks. */
  emulated: boolean;
  prompt: string;
  negativePrompt?: string;
  size?: ImageSize;
  /** Variants requested. */
  n: number;
  quality?: string;
  transparent?: boolean;
  /** Reference images sent (count only; the pixels are not kept). */
  refs?: number;
  /** Document-space rect of the selection bbox (mask) or the crop sent (emulated). */
  maskRect?: Rect;
  /** Data URL thumbnail of the mask (white = editable). */
  maskThumb?: string;
  /** Data URL thumbnail of what was sent (composite or crop). */
  inputThumb?: string;
  /** Data URL thumbnails, one per result. */
  resultThumbs: string[];
  /** Layers created from this entry (may be deleted later; resolve before use). */
  resultLayerIds: string[];
  costUsd?: number;
  durationMs: number;
  status: AiHistoryStatus;
  error?: { code: string; message: string };
  /** Shootout only: one entry per provider that took part. */
  subResults?: AiShootoutSubResult[];
  /** Shootout only: which variants were kept and where they went. */
  kept?: AiShootoutKept[];
}

/** Runtime guard for one shootout sub-result. */
export function isShootoutSubResult(v: unknown): v is AiShootoutSubResult {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isProviderId(s.provider) &&
    typeof s.model === "string" &&
    (s.mode === "generate" || s.mode === "mask" || s.mode === "instruct") &&
    typeof s.status === "string" &&
    Array.isArray(s.thumbs)
  );
}

let counter = 0;

export function newHistoryId(): string {
  counter++;
  const c = globalThis.crypto;
  const rand = c && typeof c.randomUUID === "function" ? c.randomUUID().replace(/-/g, "").slice(0, 8) : Date.now().toString(16);
  return `ai_${rand}_${counter}`;
}

/** Runtime guard for entries read back from a `.pfproj` manifest. */
export function isAiHistoryEntry(v: unknown): v is AiHistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  const base =
    typeof e.id === "string" &&
    typeof e.ts === "number" &&
    isProviderId(e.provider) &&
    typeof e.model === "string" &&
    (e.mode === "generate" || e.mode === "mask" || e.mode === "instruct" || e.mode === "shootout") &&
    typeof e.prompt === "string" &&
    Array.isArray(e.resultThumbs) &&
    Array.isArray(e.resultLayerIds) &&
    typeof e.status === "string";
  if (!base) return false;
  if (e.mode === "shootout") return Array.isArray(e.subResults) && e.subResults.every(isShootoutSubResult);
  return true;
}

/** Read the history list (newest last). Repairs a missing/garbled slot. */
export function getHistory(doc: Document): AiHistoryEntry[] {
  const raw = doc.meta[AI_HISTORY_KEY];
  if (Array.isArray(raw)) {
    if (raw.every(isAiHistoryEntry)) return raw;
    const ok = raw.filter(isAiHistoryEntry);
    doc.meta[AI_HISTORY_KEY] = ok;
    return ok;
  }
  const list: AiHistoryEntry[] = [];
  doc.meta[AI_HISTORY_KEY] = list;
  return list;
}

export function findEntry(doc: Document, id: string): AiHistoryEntry | undefined {
  return getHistory(doc).find((e) => e.id === id);
}

export function addEntry(doc: Document, entry: AiHistoryEntry): AiHistoryEntry {
  getHistory(doc).push(entry);
  doc.dirty = true;
  return entry;
}

export function updateEntry(doc: Document, id: string, patch: Partial<AiHistoryEntry>): AiHistoryEntry | undefined {
  const e = findEntry(doc, id);
  if (!e) return undefined;
  Object.assign(e, patch);
  doc.dirty = true;
  return e;
}

export function removeEntry(doc: Document, id: string): boolean {
  const list = getHistory(doc);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  doc.dirty = true;
  return true;
}

/** The entry that most recently finished, for `ai.rerunLast` / `ai.toggleDiff`. */
export function lastEntry(doc: Document): AiHistoryEntry | undefined {
  const list = getHistory(doc);
  return list[list.length - 1];
}

/** Plain-JSON copy suitable for the manifest (drops `undefined`, keeps order). */
export function serializeHistory(list: readonly AiHistoryEntry[]): unknown[] {
  return JSON.parse(JSON.stringify(list)) as unknown[];
}

/** Parse a manifest `ai_history` array back into entries, dropping anything malformed. */
export function deserializeHistory(raw: unknown): AiHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isAiHistoryEntry);
}
