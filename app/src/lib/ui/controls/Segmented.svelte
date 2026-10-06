<script lang="ts">
  /** Row of icon toggle buttons (PS selection modes new/add/subtract/intersect, align, etc.). */
  import Icon from "../icons/Icon.svelte";

  interface Seg {
    value: string;
    icon: string;
    title: string;
  }
  interface Props {
    value: string;
    items: readonly Seg[];
    onchange: (v: string) => void;
    disabled?: boolean;
  }
  let { value, items, onchange, disabled = false }: Props = $props();
</script>

<span class="seg" role="radiogroup">
  {#each items as it (it.value)}
    <button type="button" role="radio" class="b" class:on={it.value === value} aria-checked={it.value === value} aria-label={it.title} data-tip={it.title} {disabled} onclick={() => onchange(it.value)}>
      <Icon name={it.icon} size={16} />
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
