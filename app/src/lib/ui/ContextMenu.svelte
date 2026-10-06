<script lang="ts">
  import { Check } from "@lucide/svelte";
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
  <div class="menu glass" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
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
          <span class="check">{#if item.checked}<Check size={12} />{/if}</span>
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
    min-width: 200px;
    padding: 4px;
    animation: pop var(--t-fast) ease-out;
  }
  .item {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px 5px 4px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    color: var(--fg-0);
  }
  .item:not(:disabled):hover {
    background: var(--accent-soft);
  }
  .item:disabled {
    color: var(--fg-2);
  }
  .item.danger:not(:disabled):hover {
    background: rgba(255, 92, 122, 0.16);
    color: var(--danger);
  }
  .check {
    display: grid;
    place-items: center;
    color: var(--accent-2);
  }
  .sc {
    color: var(--fg-2);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    margin-left: 18px;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu {
      animation: none;
    }
  }
</style>
