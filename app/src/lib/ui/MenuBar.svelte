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
    if (!open) return;
    if (e.key === "Escape") {
      open = null;
      e.stopPropagation();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const labels = menus.filter((m) => m.children.length).map((m) => m.label);
      const i = labels.indexOf(open);
      if (i >= 0) open = labels[(i + (e.key === "ArrowRight" ? 1 : -1) + labels.length) % labels.length] ?? open;
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
    height: 100%;
    align-items: stretch;
  }
  .slot {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .menu {
    padding: 0 7px;
    font-size: var(--fs-menu);
    color: var(--ps-text);
  }
  .menu:not(:disabled):hover,
  .menu.open {
    background: var(--ps-row-selected);
  }
  .menu:disabled {
    color: var(--ps-text-disabled);
  }
  .drop {
    position: absolute;
    left: 0;
    top: 100%;
    z-index: 60;
  }
</style>
