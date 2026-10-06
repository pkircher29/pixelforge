<script lang="ts">
  /** Menu bar rendered from the command registry. Click opens; hovering slides between menus. */
  import MenuList from "./MenuList.svelte";
  import { buildMenus } from "./menu";
  import { getCommands } from "./registry.svelte";

  const menus = $derived(buildMenus(getCommands()));
  let open = $state<string | null>(null);
  let bar = $state<HTMLElement | null>(null);

  function toggle(label: string) {
    open = open === label ? null : label;
  }
  function hover(label: string) {
    if (open && open !== label) open = label;
  }
  function onWindowDown(e: PointerEvent) {
    if (open && bar && !bar.contains(e.target as Node)) open = null;
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      open = null;
      e.stopPropagation();
    }
  }
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={onKey} onblur={() => (open = null)} />

<nav class="menus" aria-label="Main menu" bind:this={bar}>
  {#each menus as m (m.label)}
    <div class="slot">
      <button
        type="button"
        class="menu"
        class:open={open === m.label}
        disabled={m.children.length === 0}
        aria-haspopup="menu"
        aria-expanded={open === m.label}
        onpointerdown={(e) => {
          e.preventDefault();
          toggle(m.label);
        }}
        onpointerenter={() => hover(m.label)}
      >
        {m.label}
      </button>
      {#if open === m.label}
        <div class="drop">
          <MenuList nodes={m.children} onrun={() => (open = null)} />
        </div>
      {/if}
    </div>
  {/each}
</nav>

<style>
  .menus {
    display: flex;
    gap: 1px;
    height: 100%;
    align-items: center;
  }
  .slot {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .menu {
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--fg-1);
    transition: background var(--t-fast) ease-out, color var(--t-fast) ease-out;
  }
  .menu:not(:disabled):hover,
  .menu.open {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .menu:disabled {
    color: var(--fg-2);
  }
  .drop {
    position: absolute;
    left: 0;
    top: calc(100% - 2px);
    z-index: 60;
    animation: drop var(--t-fast) ease-out;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .drop {
      animation: none;
    }
  }
</style>
