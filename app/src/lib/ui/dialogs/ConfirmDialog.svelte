<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";

  interface Props {
    title: string;
    message: string;
    /** Buttons left→right; the value is what `resolve` gets. */
    buttons: { label: string; value: string; primary?: boolean; danger?: boolean }[];
    resolve: Resolver<string>;
  }
  let { title, message, buttons, resolve }: Props = $props();
  const primary = $derived(buttons.find((b) => b.primary));
</script>

<Dialog {title} width={400} oncancel={() => resolve(null)} onsubmit={() => primary && resolve(primary.value)}>
  <p class="msg">{message}</p>
  {#snippet footer()}
    {#each buttons as b (b.value)}
      <button type="button" class="btn" class:primary={b.primary} class:danger={b.danger} onclick={() => resolve(b.value)}>{b.label}</button>
    {/each}
  {/snippet}
</Dialog>

<style>
  .msg {
    margin: 4px 0 8px;
    color: var(--fg-1);
    line-height: 1.5;
  }
</style>
