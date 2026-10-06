<script lang="ts">
  /** One numeric field with a label (Feather, Expand, Contract...). */
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";

  interface Props {
    title: string;
    label: string;
    unit?: string;
    min: number;
    max: number;
    step?: number;
    initial: number;
    okLabel?: string;
    resolve: Resolver<number>;
  }
  let { title, label, unit = "px", min, max, step = 1, initial, okLabel = "OK", resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let value = $state(initial);

  function submit() {
    const v = Math.max(min, Math.min(max, Number(value)));
    if (Number.isFinite(v)) resolve(v);
  }
</script>

<Dialog {title} width={340} oncancel={() => resolve(null)} onsubmit={submit}>
  <label class="field">
    <span>{label}</span>
    <span class="num">
      <input class="input" type="number" {min} {max} {step} bind:value data-autofocus />
      <span class="unit">{unit}</span>
    </span>
  </label>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={submit}>{okLabel}</button>
  {/snippet}
</Dialog>

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }
  .num {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num .input {
    width: 90px;
  }
  .unit {
    color: var(--fg-2);
    width: 24px;
  }
</style>
