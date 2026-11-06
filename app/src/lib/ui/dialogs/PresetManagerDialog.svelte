<script lang="ts">
  import { onMount } from "svelte";
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { hydratePresetAssets, listPresetAssets, renameUserAsset, deleteUserAsset, type PresetAsset, type PresetKind } from "$lib/tools/preset-assets";
  let { resolve }: { resolve: Resolver<void> } = $props();
  let kind = $state<PresetKind>("patterns");
  let assets = $state<PresetAsset[]>([]);
  let selected = $state<string | null>(null);
  let name = $state("");
  let busy = $state(false);
  let error = $state("");
  const current = $derived(assets.find(asset => asset.id === selected));
  async function load(): Promise<void> {
    busy = true; error = "";
    try {
      await hydratePresetAssets();
      const result = await listPresetAssets(kind);
      assets = result.assets; error = result.errors.join("\n");
      if (!assets.some(a => a.id === selected)) selected = null;
    } catch (e) { error = String((e as Error)?.message ?? e); }
    finally { busy = false; }
  }
  async function change(remove: boolean): Promise<void> {
    if (!current) return;
    busy = true; error = "";
    try {
      const asset = $state.snapshot(current);
      if (remove) await deleteUserAsset(kind, asset);
      else await renameUserAsset(kind, asset, name.trim());
      await load();
    } catch (e) { error = String((e as Error)?.message ?? e); }
    finally { busy = false; }
  }
  onMount(() => { void load(); });
</script>

<Dialog title="Preset Manager" width={560} oncancel={() => resolve(null)} onsubmit={() => resolve()}>
  <div class="manager">
    <label>Preset type <select class="input" bind:value={kind} disabled={busy} onchange={() => { selected = null; void load(); }}><option value="patterns">Patterns</option><option value="brushes">Sampled brushes</option></select></label>
    <div class="presets" role="listbox" aria-label="Saved presets">
      {#each assets as asset (asset.id)}
        <button type="button" role="option" aria-selected={selected === asset.id} class:active={selected === asset.id} disabled={busy} onclick={() => { selected = asset.id; name = asset.name; }}>
          <span>{asset.name}</span><small>{asset.width} × {asset.height} px</small>
        </button>
      {/each}
      {#if !assets.length}<p>{busy ? "Loading presets…" : "No saved presets. Use Edit → Define Pattern or Define Brush Preset to create one."}</p>{/if}
    </div>
    <label>Name <input class="input" aria-label="Preset name" bind:value={name} disabled={!current || busy} maxlength="128" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions"><button type="button" class="btn" disabled={!current || !name.trim() || busy} onclick={() => void change(false)}>Rename</button><button type="button" class="btn" disabled={!current || busy} onclick={() => void change(true)}>Delete</button><button type="button" class="btn primary" onclick={() => resolve()}>Done</button></div>
  </div>
</Dialog>

<style>
  .manager { display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; align-items: center; gap: 10px; }
  .presets { min-height: 160px; max-height: 300px; overflow: auto; border: 1px solid var(--ps-border-dark); }
  .presets button { display: flex; justify-content: space-between; padding: 8px; width: 100%; text-align: left; }
  .presets button:hover, .presets button.active { background: var(--ps-row-selected); }
  .presets p { padding: 12px; color: var(--ps-text-dim); }
  small { color: var(--ps-text-dim); }
  .error { color: #f88; white-space: pre-wrap; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
