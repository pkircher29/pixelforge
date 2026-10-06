# AI history (`doc.meta.aiHistory` / manifest `ai_history`)

Every AI job run on a document is recorded in the document's metadata so it round-trips
through `.pfproj`: the UI reads and writes `doc.meta.aiHistory` (an array), and the save
path hands it to `io_save_pfproj` as `manifest.ai_history`, which Rust passes through
untouched (`docs/ipc.md`). Owner: `app/src/lib/ai/history.ts`.

Thumbnails are data URLs no larger than 160 px on the longest edge; full inputs, masks and
results are **never** stored here (the result lives on its layer). A typical entry is
20–60 KB.

## Schema (version 1)

```ts
type AiHistoryEntry = {
  id: string;                 // unique within the document, "ai_<8 hex>_<n>"
  ts: number;                 // Unix ms when the job was submitted
  provider: "open_ai" | "x_ai" | "gemini";
  providerName: string;       // "ChatGPT" | "Grok" | "Gemini" at the time of the run
  model: string;              // e.g. "gemini-3.1-flash-image"
  mode: "generate" | "mask" | "instruct";
  emulated: boolean;          // mask mode on a provider without a native pixel mask
  prompt: string;             // what the user typed (the region hint is not stored)
  negativePrompt?: string;
  size?: { width: number; height: number };
  n: number;                  // variants requested
  quality?: string;           // provider-specific tier, verbatim
  transparent?: boolean;      // OpenAI transparent background
  refs?: number;              // reference images sent (count only)
  maskRect?: { x; y; w; h };  // selection bbox (native mask) or the crop sent (emulated), doc space
  maskThumb?: string;         // data URL, white = editable
  inputThumb?: string;        // data URL of the composite / crop / first reference sent
  resultThumbs: string[];     // data URLs, one per result (sparse until a variant is added)
  resultLayerIds: string[];   // layers created from this entry; may have been deleted since
  costUsd?: number;           // estimate from docs/ai-research.md tables, or provider-reported
  durationMs: number;         // provider wall time (0 while running)
  status: "running" | "completed" | "failed" | "cancelled";
  error?: { code: string; message: string };   // typed code from docs/ipc.md
};
```

Rules:

- Entries are appended in submission order; the panel shows newest first.
- `getHistory(doc)` repairs the slot: malformed entries (as judged by `isAiHistoryEntry`)
  are dropped on read, so an older or hand-edited manifest never breaks the panel.
- `resultLayerIds` are resolved against the live layer list before use ("Reveal layer" and
  "Toggle diff" are disabled when every listed layer is gone).
- The selection used for a mask run is cached **in memory only** (`rememberedSelection`
  in `run.ts`) so "Re-run with…" can reuse it during the session; after a reload the
  current selection is used instead and the panel says so.
- Unknown extra keys are preserved by JSON round-trip and ignored by the UI.

## Actions

| Action | Effect |
|---|---|
| Re-run with… | Same prompt (+ negative prompt, size and quality when the provider is unchanged), chosen provider, remembered selection if available. |
| Edit prompt & re-run | Inline textarea; runs with the chosen provider. |
| Load into panel | Fills the AI panel form with the entry's prompt / provider / model. |
| Reveal layer | Activates the document that holds the latest surviving result layer and selects it. |
| Diff | Toggles the "AI diff" overlay layer (magenta where the result changed the composite; non-undoable, `id` prefixed `aidiff_`, skip it on save/export). |
