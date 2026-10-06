<script lang="ts">
  /** PS "Global Light": Angle (dial) and Altitude. */
  import Dialog from "./Dialog.svelte";
  import LayerStyleAngleDial from "./LayerStyleAngleDial.svelte";
  import type { Resolver } from "./dialogs.svelte";

  interface Props {
    angle: number;
    altitude: number;
    resolve: Resolver<{ angle: number; altitude: number }>;
  }
  let { angle: a0, altitude: alt0, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let angle = $state(a0);
  // svelte-ignore state_referenced_locally
  let altitude = $state(alt0);

  function submit() {
    resolve({ angle, altitude: Math.max(0, Math.min(90, altitude)) });
  }
</script>

<Dialog title="Global Light" width={300} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <div class="row"><span>Angle:</span><LayerStyleAngleDial value={angle} altitude={altitude} onchange={(a, alt) => { angle = a; if (alt !== undefined) altitude = alt; }} /><span class="num"><input class="input" type="number" min="-180" max="180" bind:value={angle} data-autofocus /> °</span></div>
    <div class="row"><span>Altitude:</span><span></span><span class="num"><input class="input" type="number" min="0" max="90" bind:value={altitude} /> °</span></div>
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
    grid-template-columns: 56px 44px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    text-align: right;
    color: var(--ps-text-dim);
  }
  .num {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .num .input {
    width: 56px;
  }
</style>
