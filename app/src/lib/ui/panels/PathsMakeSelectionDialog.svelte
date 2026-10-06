<script lang="ts">
  /** PS "Make Selection": Feather Radius, Anti-aliased, Operation. */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";

  type Mode = "replace" | "add" | "subtract" | "intersect";
  interface Props {
    feather: number;
    aa: boolean;
    hasSelection: boolean;
    resolve: Resolver<{ feather: number; aa: boolean; mode: Mode }>;
  }
  let { feather: f0, aa: aa0, hasSelection, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let feather = $state(f0);
  // svelte-ignore state_referenced_locally
  let aa = $state(aa0);
  let mode = $state<Mode>("replace");

  function ok() {
    resolve({ feather: Math.max(0, Math.min(250, Number(feather) || 0)), aa, mode });
  }
</script>

<Dialog title="Make Selection" width={320} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <legend>Rendering</legend>
    <label class="c">Feather Radius: <input class="input num" type="number" min="0" max="250" step="0.5" bind:value={feather} data-autofocus /> pixels</label>
    <label class="c"><input type="checkbox" bind:checked={aa} /> Anti-aliased</label>
  </fieldset>
  <fieldset class="ps-group">
    <legend>Operation</legend>
    <label class="c"><input type="radio" name="op" checked={mode === "replace"} onchange={() => (mode = "replace")} /> New Selection</label>
    <label class="c"><input type="radio" name="op" disabled={!hasSelection} checked={mode === "add"} onchange={() => (mode = "add")} /> Add to Selection</label>
    <label class="c"><input type="radio" name="op" disabled={!hasSelection} checked={mode === "subtract"} onchange={() => (mode = "subtract")} /> Subtract from Selection</label>
    <label class="c"><input type="radio" name="op" disabled={!hasSelection} checked={mode === "intersect"} onchange={() => (mode = "intersect")} /> Intersect with Selection</label>
  </fieldset>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={ok}>OK</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .ps-group {
    display: grid;
    gap: 5px;
    margin-bottom: 10px;
  }
  .c {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 56px;
  }
</style>
