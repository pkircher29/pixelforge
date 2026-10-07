<script lang="ts">
  /** PS History Options: the three checkboxes (non-linear history is not supported here). */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";
  import { historyUi } from "./History.store.svelte";

  interface Props {
    resolve: Resolver<void>;
  }
  let { resolve }: Props = $props();
  let autoFirst = $state(historyUi.options.autoFirstSnapshot);
  let showDialog = $state(historyUi.options.showSnapshotDialog);

  function ok() {
    historyUi.setOptions({ autoFirstSnapshot: autoFirst, showSnapshotDialog: showDialog });
    resolve(null);
  }
</script>

<Dialog title="History Options" width={360} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="opts">
    <label><input type="checkbox" bind:checked={autoFirst} /> Automatically Create First Snapshot</label>
    <label><input type="checkbox" bind:checked={showDialog} /> Show New Snapshot Dialog by Default</label>
    <label class="off" title="Non-linear history is not supported."><input type="checkbox" disabled /> Allow Non-Linear History</label>
  </div>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={ok}>OK</button>
  {/snippet}
</Dialog>

<style>
  .opts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 0 4px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ps-text);
  }
  label.off {
    color: var(--ps-text-disabled);
  }
</style>
