<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { BLEND_MODES, BLEND_MODE_LABEL, type BlendMode, type LayerProps } from "$lib/engine";

  interface Props {
    name: string;
    opacity: number;
    blendMode: BlendMode;
    isGroup: boolean;
    resolve: Resolver<Partial<LayerProps>>;
  }
  let { name: initialName, opacity: initialOpacity, blendMode: initialMode, isGroup, resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  // svelte-ignore state_referenced_locally
  let opacity = $state(Math.round(initialOpacity * 100));
  // svelte-ignore state_referenced_locally
  let blendMode = $state<BlendMode>(initialMode);

  function submit() {
    resolve({ name: name.trim() || initialName, opacity: Math.max(0, Math.min(100, opacity)) / 100, blendMode });
  }
</script>

<Dialog title={isGroup ? "Group properties" : "Layer properties"} width={380} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <label class="row"><span>Name</span><input class="input" type="text" bind:value={name} data-autofocus /></label>
    <label class="row">
      <span>Blend mode</span>
      <select class="select" bind:value={blendMode}>
        {#each BLEND_MODES as m (m)}
          <option value={m}>{BLEND_MODE_LABEL[m]}</option>
        {/each}
      </select>
    </label>
    <label class="row">
      <span>Opacity</span>
      <span class="slider"><input type="range" min="0" max="100" bind:value={opacity} /><span class="val">{opacity}%</span></span>
    </label>
  </div>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={submit}>Apply</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 10px;
  }
  .row > span:first-child {
    color: var(--fg-1);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider input {
    flex: 1;
  }
  .val {
    width: 40px;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
