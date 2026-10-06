<script lang="ts">
  /** PS "Channel Options": Name, Color Indicates (masked / selected — informational), overlay Color + Opacity. */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";
  import type { RGBA } from "$lib/engine";
  import { rgbaToHex, hexToRgba } from "../dialogs/layer-style-model";

  interface Props {
    name: string;
    color: RGBA;
    opacity: number;
    resolve: Resolver<{ name: string; color: RGBA; opacity: number }>;
  }
  let { name: n0, color: c0, opacity: o0, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let name = $state(n0);
  // svelte-ignore state_referenced_locally
  let color = $state<RGBA>({ ...c0 });
  // svelte-ignore state_referenced_locally
  let opacity = $state(Math.round(o0 * 100));

  function ok() {
    resolve({ name: name.trim() || n0, color, opacity: Math.max(0, Math.min(100, opacity)) / 100 });
  }
</script>

<Dialog title="Channel Options" width={320} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="grid">
    <label class="row"><span>Name:</span><input class="input" type="text" bind:value={name} data-autofocus /></label>
    <fieldset class="ps-group">
      <legend>Color Indicates</legend>
      <label class="c"><input type="radio" name="ci" checked disabled /> Masked Areas</label>
      <label class="c"><input type="radio" name="ci" disabled /> Selected Areas</label>
      <label class="c"><input type="radio" name="ci" disabled /> Spot Color</label>
    </fieldset>
    <fieldset class="ps-group">
      <legend>Color</legend>
      <div class="inline">
        <input type="color" class="swatch" value={rgbaToHex(color)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) color = c; }} aria-label="Overlay color" />
        <label class="c">Opacity: <input class="input num" type="number" min="0" max="100" bind:value={opacity} /> %</label>
      </div>
    </fieldset>
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={ok}>OK</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 10px;
  }
  .row {
    display: grid;
    grid-template-columns: 48px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row > span {
    text-align: right;
    color: var(--ps-text-dim);
  }
  .ps-group {
    display: grid;
    gap: 4px;
  }
  .c {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .swatch {
    width: 40px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--ps-border-dark);
    background: none;
  }
  .num {
    width: 50px;
  }
</style>
