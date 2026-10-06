<script lang="ts">
  /** Right dock: registry panels as collapsible, resizable sections; draggable width. */
  import { ChevronDown, ChevronRight, X } from "@lucide/svelte";
  import { getPanels, type PanelDef } from "./registry.svelte";
  import { ui } from "$lib/stores/ui.svelte";

  const panels = $derived(getPanels("right").filter((p) => ui.isPanelVisible(p.id)));

  function defaults(p: PanelDef) {
    return { weight: (p.preferredSize ?? 300) / 300, collapsed: p.collapsed ?? false };
  }
  // Pure read; writes go through ui.setPanel from event handlers only.
  function layout(p: PanelDef) {
    return ui.panel(p.id, defaults(p));
  }

  // Width drag on the left edge.
  function startWidthDrag(e: PointerEvent) {
    const startX = e.clientX;
    const startW = ui.dockWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => (ui.dockWidth = Math.max(200, Math.min(600, startW - (ev.clientX - startX))));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      ui.setDockWidth(ui.dockWidth);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  // Divider drag between two expanded panels: trade weight proportional to pixels.
  function startDividerDrag(e: PointerEvent, above: PanelDef, below: PanelDef, container: HTMLElement) {
    const a = layout(above);
    const b = layout(below);
    const startY = e.clientY;
    const wa = a.weight;
    const wb = b.weight;
    const total = wa + wb;
    const aEl = container.querySelector<HTMLElement>(`[data-panel="${above.id}"] .body`);
    const bEl = container.querySelector<HTMLElement>(`[data-panel="${below.id}"] .body`);
    const px = (aEl?.offsetHeight ?? 150) + (bEl?.offsetHeight ?? 150);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const frac = Math.max(0.1, Math.min(0.9, (wa / total) + (ev.clientY - startY) / Math.max(1, px)));
      ui.setPanel(above.id, { weight: frac * total }, defaults(above));
      ui.setPanel(below.id, { weight: (1 - frac) * total }, defaults(below));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  let dock = $state<HTMLElement | null>(null);
</script>

<aside class="dock" aria-label="Panels" bind:this={dock} style:width="{ui.dockWidth}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="width-handle" onpointerdown={startWidthDrag}></div>
  {#each panels as p, i (p.id)}
    {@const l = layout(p)}
    {@const prevExpanded = i > 0 && !layout(panels[i - 1]!).collapsed}
    {#if i > 0 && prevExpanded && !l.collapsed}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="divider" onpointerdown={(e) => dock && startDividerDrag(e, panels[i - 1]!, p, dock)}></div>
    {/if}
    <section class="panel" class:collapsed={l.collapsed} data-panel={p.id} style:flex={l.collapsed ? "0 0 auto" : `${l.weight} 1 0px`}>
      <header class="head">
        <button type="button" class="toggle" onclick={() => ui.setPanel(p.id, { collapsed: !l.collapsed }, defaults(p))} aria-expanded={!l.collapsed}>
          <span class="chev">{#if l.collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}</span>
          {#if p.icon}<span class="pic"><p.icon size={13} strokeWidth={1.75} /></span>{/if}
          <span class="title">{p.title}</span>
        </button>
        <button type="button" class="icon-btn hide" aria-label="Hide {p.title}" data-tip="Hide panel" onclick={() => ui.togglePanel(p.id)}><X size={12} /></button>
      </header>
      {#if !l.collapsed}
        <div class="body">
          <p.component />
        </div>
      {/if}
    </section>
  {:else}
    <div class="empty">All panels are hidden. Use the Window menu to show them.</div>
  {/each}
</aside>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-1);
    border-left: 1px solid var(--border);
  }
  .width-handle {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
    z-index: 5;
  }
  .width-handle:hover {
    background: linear-gradient(90deg, transparent, rgba(139, 108, 255, 0.35), transparent);
  }
  .divider {
    flex: none;
    height: 5px;
    margin: -2px 0;
    cursor: ns-resize;
    z-index: 4;
  }
  .divider:hover {
    background: linear-gradient(180deg, transparent, rgba(139, 108, 255, 0.35), transparent);
  }
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-bottom: 1px solid var(--border);
  }
  .panel:not(.collapsed) {
    min-height: 96px;
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 4px 0 6px;
    background: var(--bg-2);
  }
  .toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    text-align: left;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--fg-1);
  }
  .toggle:hover {
    color: var(--fg-0);
  }
  .chev,
  .pic {
    display: grid;
    color: var(--fg-2);
  }
  .hide {
    opacity: 0;
    transition: opacity var(--t-fast) ease-out;
  }
  .head:hover .hide {
    opacity: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .empty {
    padding: 16px;
    color: var(--fg-2);
    font-size: var(--fs-sm);
  }
</style>
