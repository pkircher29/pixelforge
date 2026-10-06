<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { recentClear } from "$lib/io/files";
  import { runCommand, getCommand } from "$lib/ui/registry.svelte";

  interface Props {
    resolve: Resolver<void>;
  }
  let { resolve }: Props = $props();

  let budget = $state(settings.value.historyBudgetMb);
  let provider = $state<string>(settings.value.defaultProvider ?? "");
  const hasKeysDialog = $derived(Boolean(getCommand("ai.keys")));

  async function apply() {
    await settings.set({
      historyBudgetMb: Math.max(64, Math.min(16384, Math.round(budget))),
      defaultProvider: (provider || null) as "open_ai" | "x_ai" | "gemini" | null,
    });
    resolve(null);
  }
</script>

<Dialog title="Preferences" width={440} oncancel={() => resolve(null)} onsubmit={apply}>
  <div class="grid">
    <label class="row">
      <span>Undo memory</span>
      <span class="inline">
        <input class="input num" type="number" min="64" max="16384" step="64" bind:value={budget} data-autofocus />
        <span class="hint">MB of layer snapshots kept for undo</span>
      </span>
    </label>
    <label class="row">
      <span>Default AI provider</span>
      <select class="select" bind:value={provider}>
        <option value="">Ask each time</option>
        <option value="open_ai">OpenAI (ChatGPT)</option>
        <option value="x_ai">xAI (Grok)</option>
        <option value="gemini">Google Gemini</option>
      </select>
    </label>
    <div class="row">
      <span>API keys</span>
      {#if hasKeysDialog}
        <button type="button" class="btn" onclick={() => void runCommand("ai.keys")}>Manage keys…</button>
      {:else}
        <span class="hint">Available once the AI panel is installed.</span>
      {/if}
    </div>
    <div class="row">
      <span>Layout</span>
      <span class="inline">
        <button type="button" class="btn" onclick={() => ui.resetLayout()}>Reset panels</button>
        <button type="button" class="btn" onclick={() => void recentClear()}>Clear recent files</button>
      </span>
    </div>
  </div>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={apply}>Save</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 12px;
  }
  .row {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 10px;
  }
  .row > span:first-child {
    color: var(--fg-1);
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .num {
    width: 90px;
  }
  .hint {
    color: var(--fg-2);
    font-size: var(--fs-xs);
  }
</style>
