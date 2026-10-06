<script lang="ts">
  /** PS "Lock Layers" dialog: the four lock toggles for the selected layers. */
  import Dialog from "./Dialog.svelte";
  import Icon from "../icons/Icon.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import type { LayerLock } from "$lib/engine";

  interface Props {
    lock: LayerLock;
    count: number;
    resolve: Resolver<LayerLock>;
  }
  let { lock: initial, count, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let lock = $state<LayerLock>({ ...initial });

  function submit() {
    resolve({ ...lock });
  }
</script>

<Dialog title="Lock Layers" width={300} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <p class="hint">{count === 1 ? "Lock for the selected layer:" : `Lock for ${count} selected layers:`}</p>
    <label class="c"><input type="checkbox" bind:checked={lock.transparent} disabled={lock.all} data-autofocus /><Icon name="lock-transparent" size={14} /> Transparent Pixels</label>
    <label class="c"><input type="checkbox" bind:checked={lock.pixels} disabled={lock.all} /><Icon name="lock-pixels" size={14} /> Image Pixels</label>
    <label class="c"><input type="checkbox" bind:checked={lock.position} disabled={lock.all} /><Icon name="lock-position" size={14} /> Position</label>
    <label class="c"><input type="checkbox" bind:checked={lock.all} /><Icon name="lock-all" size={14} /> All</label>
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={submit}>OK</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 7px;
  }
  .hint {
    margin: 0 0 2px;
    color: var(--ps-text-dim);
  }
  .c {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
</style>
