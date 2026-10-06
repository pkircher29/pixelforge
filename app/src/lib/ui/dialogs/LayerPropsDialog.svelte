<script lang="ts">
  /** PS "Layer Properties" / "Group Properties": Name and Color. */
  import Dialog from "./Dialog.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import type { LayerColor, LayerProps } from "$lib/engine";

  interface Props {
    name: string;
    color: LayerColor | null;
    isGroup: boolean;
    resolve: Resolver<Partial<LayerProps>>;
  }
  let { name: initialName, color: initialColor, isGroup, resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  // svelte-ignore state_referenced_locally
  let color = $state<string>(initialColor ?? "none");

  const COLORS = [
    { value: "none", label: "None" },
    { value: "red", label: "Red" },
    { value: "orange", label: "Orange" },
    { value: "yellow", label: "Yellow" },
    { value: "green", label: "Green" },
    { value: "blue", label: "Blue" },
    { value: "violet", label: "Violet" },
    { value: "gray", label: "Gray" },
  ];

  function submit() {
    resolve({ name: name.trim() || initialName, color: color === "none" ? null : (color as LayerColor) });
  }
</script>

<Dialog title={isGroup ? "Group Properties" : "Layer Properties"} width={360} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <label class="row"><span>Name:</span><input class="input" type="text" bind:value={name} data-autofocus /></label>
    <div class="row"><span>Color:</span><PsSelect value={color} choices={COLORS} width={110} onchange={(v) => (color = v)} /></div>
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={submit}>OK</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    text-align: right;
    color: var(--ps-text-dim);
  }
</style>
