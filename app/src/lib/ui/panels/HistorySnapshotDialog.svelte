<script lang="ts">
  /** One text field with a label — New Snapshot… / rename, swatch and group names. */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";

  interface Props {
    title: string;
    label: string;
    initial: string;
    okLabel?: string;
    /** Extra "From" row for PS's New Snapshot dialog. */
    from?: boolean;
    resolve: Resolver<string>;
  }
  let { title, label, initial, okLabel = "OK", from = false, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let value = $state(initial);

  function submit() {
    const v = value.trim();
    if (v) resolve(v);
  }
</script>

<Dialog {title} width={360} oncancel={() => resolve(null)} onsubmit={submit}>
  <label class="field">
    <span>{label}</span>
    <input class="input" type="text" bind:value data-autofocus spellcheck="false" />
  </label>
  {#if from}
    <label class="field">
      <span>From:</span>
      <select class="select" disabled><option>Full Document</option></select>
    </label>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={submit}>{okLabel}</button>
  {/snippet}
</Dialog>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }
  .field span {
    width: 50px;
    text-align: right;
    color: var(--ps-text);
  }
  .field .input,
  .field .select {
    flex: 1;
  }
</style>
