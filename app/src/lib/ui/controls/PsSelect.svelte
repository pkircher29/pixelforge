<script lang="ts">
  /** PS dropdown: dark well with ▾, opens a flat popup list with a ✓ on the current row. */
  import Popover from "./Popover.svelte";
  import Icon from "../icons/Icon.svelte";

  interface Choice {
    value: string;
    label: string;
  }
  interface Props {
    value: string;
    choices: readonly Choice[];
    onchange: (v: string) => void;
    label?: string;
    width?: number;
    disabled?: boolean;
    /** Plain-label style (no well), as in the Layers panel blend-mode field. */
    flat?: boolean;
  }
  let { value, choices, onchange, label, width, disabled = false, flat = false }: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);
  const current = $derived(choices.find((c) => c.value === value)?.label ?? value);

  function pick(v: string) {
    open = false;
    if (v !== value) onchange(v);
  }
  function onKey(e: KeyboardEvent) {
    if (disabled) return;
    const i = choices.findIndex((c) => c.value === value);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const n = choices[(i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length];
      if (n) onchange(n.value);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      open = !open;
    }
  }
</script>

<span class="wrap">
  {#if label}<span class="lbl">{label}:</span>{/if}
  <button type="button" class="sel" class:flat class:open bind:this={btn} {disabled} style:width={width ? `${width}px` : undefined} aria-haspopup="listbox" aria-expanded={open} onclick={() => (open = !open)} onkeydown={onKey}>
    <span class="cur">{current}</span>
    <Icon name="caret-small" size={12} />
  </button>
  <Popover anchor={btn} open={open} onclose={() => (open = false)} minWidth={btn?.offsetWidth ?? 0}>
    <div class="list" role="listbox">
      {#each choices as c (c.value)}
        <button type="button" role="option" class="row" class:on={c.value === value} aria-selected={c.value === value} onclick={() => pick(c.value)}>
          <span class="chk">{#if c.value === value}<Icon name="check" size={12} />{/if}</span>
          <span>{c.label}</span>
        </button>
      {/each}
    </div>
  </Popover>
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--row-h);
  }
  .lbl {
    color: var(--ps-text-dim);
    white-space: nowrap;
  }
  .sel {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: var(--input-h);
    min-width: 56px;
    padding: 0 2px 0 5px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    color: var(--ps-text);
    text-align: left;
    white-space: nowrap;
  }
  .sel.flat {
    background: none;
    border-color: transparent;
    box-shadow: none;
    min-width: 0;
  }
  .sel:hover:not(:disabled),
  .sel.open {
    border-color: var(--ps-border-light);
  }
  .sel.flat:hover:not(:disabled) {
    background: var(--ps-hover);
  }
  .sel:disabled {
    color: var(--ps-text-disabled);
  }
  .cur {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--row-h);
    padding: 0 10px 0 4px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .row:hover,
  .row.on:hover {
    background: var(--ps-row-selected);
  }
  .row.on {
    background: var(--ps-row-selected-inactive);
  }
  .chk {
    display: grid;
    width: 14px;
    place-items: center;
  }
</style>
