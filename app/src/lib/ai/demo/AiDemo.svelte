<script lang="ts">
  /**
   * Standalone harness: AI panel + AI History panel next to a canvas running the engine
   * demo document, with a synthetic provider list so the UI can be exercised outside the
   * shell (and outside Tauri: Run shows the local failure path).
   *
   * Mount from a scratch `main.ts`: `mount(AiDemo, { target: document.body })`.
   */
  import { onMount } from "svelte";
  import { Rect, Selection } from "$lib/engine";
  import { buildDemoDocument } from "$lib/engine/demo/demo";
  import { docStore } from "$lib/stores/doc.svelte";
  import AiPanel from "$lib/ui/panels/AiPanel.svelte";
  import AiHistoryPanel from "$lib/ui/panels/AiHistoryPanel.svelte";
  import { aiUi } from "$lib/ai/ui.svelte";
  import { addEntry, newHistoryId } from "$lib/ai/history";
  import type { ProviderInfo } from "$lib/ai/types";
  import "$lib/ai/register";

  const providers: ProviderInfo[] = [
    {
      id: "open_ai",
      name: "ChatGPT",
      vendor: "OpenAI",
      hasKey: true,
      keyBackend: "keyring",
      defaultModel: "gpt-image-2.5-flare",
      editModel: "gpt-image-2.5-sunburst",
      models: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"],
      capabilities: {
        generate: true,
        maskEdit: true,
        instructEdit: true,
        multiRef: true,
        maxRefs: 16,
        sizes: [
          { width: 1024, height: 1024 },
          { width: 1536, height: 1024 },
          { width: 1024, height: 1536 },
        ],
        customSizes: true,
        aspectRatios: [],
        resolutions: [],
        maxPx: 3840,
        maxVariants: 10,
        transparentBg: true,
        models: ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"],
      },
    },
    {
      id: "x_ai",
      name: "Grok",
      vendor: "xAI",
      hasKey: false,
      keyBackend: "keyring",
      defaultModel: "grok-imagine-image-2.0",
      editModel: "grok-imagine-image-2.0",
      models: ["grok-imagine-image-2.0", "grok-imagine-image"],
      capabilities: {
        generate: true,
        maskEdit: false,
        instructEdit: true,
        multiRef: true,
        maxRefs: 5,
        sizes: [],
        customSizes: true,
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        resolutions: ["1k", "1.5k", "2k"],
        maxPx: 2048,
        maxVariants: 10,
        transparentBg: false,
        models: ["grok-imagine-image-2.0", "grok-imagine-image"],
      },
    },
    {
      id: "gemini",
      name: "Gemini",
      vendor: "Google",
      hasKey: true,
      keyBackend: "file",
      defaultModel: "gemini-3.1-flash-image",
      editModel: "gemini-3.1-flash-image",
      models: ["gemini-3.1-flash-image", "gemini-3-pro-image"],
      capabilities: {
        generate: true,
        maskEdit: false,
        instructEdit: true,
        multiRef: true,
        maxRefs: 14,
        sizes: [],
        customSizes: true,
        aspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16"],
        resolutions: ["512", "1K", "2K", "4K"],
        maxPx: 4096,
        maxVariants: 4,
        transparentBg: false,
        models: ["gemini-3.1-flash-image", "gemini-3-pro-image"],
      },
    },
  ];

  let selectionOn = $state(true);

  onMount(() => {
    aiUi.setProviders(providers);
    aiUi.providerId = "gemini";
    const doc = buildDemoDocument();
    const open = docStore.open(doc, null);
    addEntry(doc, {
      id: newHistoryId(),
      ts: Date.now() - 60_000,
      provider: "x_ai",
      providerName: "Grok",
      model: "grok-imagine-image-2.0",
      mode: "generate",
      emulated: false,
      prompt: "a neon fox on a rainy street, cinematic",
      n: 1,
      resultThumbs: [],
      resultLayerIds: [doc.layers[0]!.id],
      durationMs: 8400,
      status: "completed",
      costUsd: 0.04,
    });
    open.version++;
  });

  function toggleSelection(): void {
    const open = docStore.active;
    if (!open) return;
    selectionOn = !selectionOn;
    open.doc.selection = selectionOn
      ? Selection.fromEllipse(open.doc.width, open.doc.height, Rect.make(140, 120, 220, 200))
      : Selection.none(open.doc.width, open.doc.height);
    open.version++;
  }
</script>

<div class="demo">
  <main>
    <p>AI panel demo. Document: {docStore.doc?.name ?? "–"} {docStore.doc?.width} x {docStore.doc?.height}, layers: {docStore.doc?.layers.length ?? 0}</p>
    <button type="button" onclick={toggleSelection}>{selectionOn ? "Deselect" : "Select ellipse"}</button>
    <ul>
      {#each docStore.doc?.layers ?? [] as l (l.id)}
        <li class:active={l.id === docStore.doc?.activeLayerId}>{l.name}</li>
      {/each}
    </ul>
  </main>
  <aside>
    <section><h3>AI</h3><AiPanel /></section>
    <section><h3>AI History</h3><AiHistoryPanel /></section>
  </aside>
</div>

<style>
  .demo {
    display: grid;
    grid-template-columns: 1fr 300px;
    height: 100vh;
    background: var(--bg-0);
    color: var(--fg-0);
  }
  main {
    padding: 16px;
  }
  aside {
    display: grid;
    grid-template-rows: 1fr 1fr;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    min-height: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h3 {
    margin: 0;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-2);
    color: var(--fg-1);
  }
  li.active {
    color: var(--accent-2);
  }
</style>
