<script lang="ts">
  /** History snapshot and state-retention preferences. */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";
  import { historyUi } from "./History.store.svelte";

  interface Props {
    resolve: Resolver<void>;
  }
  let { resolve }: Props = $props();
  let autoFirst = $state(historyUi.options.autoFirstSnapshot);
  let showDialog = $state(historyUi.options.showSnapshotDialog);
  let nonLinear = $state(historyUi.options.nonLinear);

  function ok() {
    historyUi.setOptions({ autoFirstSnapshot: autoFirst, showSnapshotDialog: showDialog, nonLinear });
    resolve(null);
  }
</script>

<Dialog title="History Options" width={360} oncancel={() => resolve(null)} onsubmit={ok}>
  <div class="opts">
    <label><input type="checkbox" bind:checked={autoFirst} /> Automatically Create First Snapshot</label>
    <label><input type="checkbox" bind:checked={showDialog} /> Show New Snapshot Dialog by Default</label>
    <label><input type="checkbox" bind:checked={nonLinear} /> Allow Non-Linear History</label>
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
</style>
