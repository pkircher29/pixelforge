<script lang="ts">
  /** Font family picker: current family in its own face; popover list with a live sample per row and a filter box. */
  import Popover from "$lib/ui/controls/Popover.svelte";
  import Icon from "$lib/ui/icons/Icon.svelte";
  import { fontsNow, listFonts, quoteFamily } from "../fonts";

  interface Props {
    value: string;
    onchange: (v: string) => void;
    width?: number;
  }
  let { value, onchange, width = 150 }: Props = $props();
  let btn = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let filter = $state("");
  let fonts = $state<string[]>(fontsNow());
  let filterEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!open) return;
    void listFonts().then((f) => (fonts = f));
    queueMicrotask(() => filterEl?.focus());
  });
  const shown = $derived(filter ? fonts.filter((f) => f.toLowerCase().includes(filter.toLowerCase())) : fonts);
</script>

<span class="wrap">
  <button type="button" class="sel" bind:this={btn} style:width="{width}px" aria-label="Font family" aria-haspopup="listbox" onclick={() => (open = !open)}>
    <span class="cur" style:font-family={quoteFamily(value)}>{value}</span>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={300}>
    <div class="pop">
      <input class="input filter" type="text" placeholder="Search fonts" bind:value={filter} bind:this={filterEl} onkeydown={(e) => e.stopPropagation()} />
      <div class="list" role="listbox" aria-label="Fonts">
        {#each shown as f (f)}
          <button type="button" role="option" class="row" class:on={f === value} aria-selected={f === value} onclick={() => { onchange(f); open = false; }}>
            <span class="chk">{#if f === value}<Icon name="check" size={12} />{/if}</span>
            <span class="name">{f}</span>
            <span class="sample" style:font-family={quoteFamily(f)}>Sample</span>
          </button>
        {/each}
        {#if shown.length === 0}
          <div class="empty">No font matches “{filter}”.</div>
        {/if}
      </div>
    </div>
  </Popover>
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
  }
  .sel {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: var(--input-h);
    padding: 0 2px 0 5px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    color: var(--ps-text);
    text-align: left;
  }
  .sel:hover {
    border-color: var(--ps-border-light);
  }
  .cur {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop {
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
  }
  .filter {
    width: 100%;
  }
  .list {
    max-height: 340px;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 24px;
    padding: 0 6px 0 2px;
    color: var(--ps-text);
    text-align: left;
  }
  .row:hover,
  .row.on {
    background: var(--ps-row-selected);
  }
  .chk {
    display: grid;
    width: 14px;
    place-items: center;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sample {
    color: var(--ps-text-dim);
    font-size: 14px;
  }
  .empty {
    padding: 8px;
    color: var(--ps-text-dim);
  }
</style>
