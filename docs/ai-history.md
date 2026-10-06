# AI history (`doc.meta.aiHistory` / manifest `ai_history`)

Every AI job run on a document is recorded in the document's metadata so it round-trips
through `.pfproj`: the UI reads and writes `doc.meta.aiHistory` (an array, key constant
`AI_HISTORY_KEY`), and `app/src/lib/io/convert.ts` maps it to `manifest.ai_history`
(snake_case) on save and back on open; Rust passes the array through untouched
(`docs/ipc.md`, `docs/pfproj-format.md`). Owner: `app/src/lib/ai/history.ts`; the
save → open round trip is covered by `tests/io.test.ts`.

Thumbnails are data URLs no larger than 160 px on the longest edge; full inputs, masks and
results are **never** stored here (the result lives on its layer). A typical entry is
20–60 KB.

## Schema (version 2)

Version 2 (Wave 5, `ai-custom`) adds custom provider ids (`custom:<registry id>`) and the
`shootout` mode. Version 1 entries read back unchanged.

```ts
type ProviderId = "open_ai" | "x_ai" | "gemini" | `custom:${string}`;

type AiHistoryEntry = {
  id: string;                 // unique within the document, "ai_<8 hex>_<n>"
  ts: number;                 // Unix ms when the job was submitted
  provider: ProviderId;       // for a shootout: the first provider that took part
  providerName: string;       // "ChatGPT" | "Grok" | "Gemini" | custom name; "Shootout (n providers)"
  model: string;              // e.g. "gemini-3.1-flash-image"; "" for a shootout
  mode: "generate" | "mask" | "instruct" | "shootout";
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
  subResults?: AiShootoutSubResult[];          // shootout only: one per provider (required for mode "shootout")
  kept?: AiShootoutKept[];                     // shootout only: which variants the user kept
};

type AiShootoutSubResult = {
  provider: ProviderId; providerName: string; model: string;
  mode: "generate" | "mask" | "instruct";      // the mode *this* provider ran (mask may be emulated per provider)
  emulated: boolean;
  status: "running" | "completed" | "failed" | "cancelled";
  durationMs: number; costUsd?: number;
  error?: { code: string; message: string };
  thumbs: string[];                            // data URLs, one per variant ("" while missing)
};

type AiShootoutKept = {
  provider: ProviderId; index: number;         // variant index within that provider's results
  as: "layer" | "document";
  layerId?: string; docId?: string;
};
```

Shootout entries (`lib/ai/shootout.ts`): one entry per shootout, created when the fan-out
starts; `subResults[i]` is rewritten whenever provider *i* settles or is re-rolled;
`status` becomes `completed` as soon as **any** provider succeeded (`failed` only when all
failed); `resultThumbs` is the flattened `subResults[].thumbs`; `resultLayerIds` lists the
layers created by "Keep as layers" (so Reveal / Diff work); `kept` records every keep,
including "Keep as new documents" (`docId` of the new document). `inputThumb` holds the
original composite in edit modes (the gallery's "Original" column). Per-provider runs
inside a shootout do **not** create their own entries (`AiRunRequest.noHistory`).

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
| Diff | Toggles the "AI diff" overlay layer (magenta where the result changed the composite; non-undoable, `id` prefixed `aidiff_`). `withoutDiffOverlays(doc)` in `lib/ai/overlay.ts` gives a view without it; save, export, copy, merge/flatten and AI inputs all use it, so the overlay never leaves the screen. |
