<script lang="ts">
  /**
   * Row of toggle buttons (PS selection modes new/add/subtract/intersect, align, etc.).
   * Items show an icon, or a text `label` (e.g. "API key | ChatGPT subscription").
   */
  import Icon from "../icons/Icon.svelte";

  interface Seg {
    value: string;
    icon?: string;
    label?: string;
    title: string;
  }
  interface Props {
    value: string;
    items: readonly Seg[];
    onchange: (v: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
  }
  let { value, items, onchange, disabled = false, ariaLabel }: Props = $props();
</script>

<span class="seg" role="radiogroup" aria-label={ariaLabel}>
  {#each items as it (it.value)}
    <button type="button" role="radio" class="b" class:text={!!it.label} class:on={it.value === value} aria-checked={it.value === value} aria-label={it.title} data-tip={it.title} {disabled} onclick={() => onchange(it.value)}>
      {#if it.label}{it.label}{:else if it.icon}<Icon name={it.icon} size={16} />{/if}
    </button>
  {/each}
</span>

<style>
  .seg {
    display: inline-flex;
    gap: 1px;
    height: var(--row-h);
    align-items: center;
  }
  .b {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .b.text {
    width: auto;
    padding: 0 8px;
    white-space: nowrap;
  }
  .b:hover:not(:disabled) {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .b.on {
    background: var(--ps-active);
    color: var(--ps-text);
    box-shadow: inset 0 0 0 1px var(--ps-border-dark);
  }
  .b:disabled {
    opacity: 0.4;
  }
</style>
