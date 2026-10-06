<script lang="ts">
  import Icon from "./icons/Icon.svelte";
  import { contextMenu } from "./context-menu.svelte";

  let el = $state<HTMLDivElement | null>(null);

  // Keep the menu on screen.
  const pos = $derived.by(() => {
    const s = contextMenu.state;
    if (!s) return { x: 0, y: 0 };
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 200;
    return {
      x: Math.min(s.x, window.innerWidth - w - 8),
      y: Math.min(s.y, window.innerHeight - h - 8),
    };
  });

  function onWindowDown(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) contextMenu.close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") contextMenu.close();
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={onKey} onblur={() => contextMenu.close()} />

{#if contextMenu.state}
  <div class="menu ps-popup" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#each contextMenu.state.items as item, i (i)}
      {#if item.separator}
        <div class="sep" role="separator"></div>
      {:else}
        <button
          type="button"
          role="menuitem"
          class="item"
          class:danger={item.danger}
          disabled={item.disabled}
          onclick={() => {
            contextMenu.close();
            void item.run?.();
          }}
        >
          <span class="check">{#if item.checked}<Icon name="check" size={12} />{/if}</span>
          <span class="label">{item.label}</span>
          {#if item.shortcut}<span class="sc">{item.shortcut}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 980;
    min-width: 190px;
    padding: 3px 0;
  }
  .item {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: 24px;
    padding: 0 12px 0 4px;
    text-align: left;
    font-size: var(--fs-menu);
    color: var(--ps-text);
    white-space: nowrap;
  }
  .item:not(:disabled):hover {
    background: var(--ps-row-selected);
  }
  .item:disabled {
    color: var(--ps-text-disabled);
  }
  .item.danger:not(:disabled):hover {
    background: var(--ps-row-selected);
  }
  .check {
    display: grid;
    place-items: center;
  }
  .label {
    padding-right: 24px;
  }
  .sc {
    color: var(--ps-text-dim);
    font-size: var(--fs-sm);
  }
  .sep {
    height: 1px;
    margin: 3px 1px;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
</style>
