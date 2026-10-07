<script lang="ts">
  /**
   * Panel column: PS tab groups. Each group has a tab strip (tabs · ≡ panel menu),
   * double-click the strip to collapse the group to an icon row, drag the divider between
   * groups to resize, drag a tab onto another strip (or the bottom drop zone) to move it.
   * The ▸▸ button at the top collapses the whole column to an icon strip.
   */
  import { untrack, type Component } from "svelte";
  import { getPanels, getPanel, type PanelDef, type CommandDef } from "./registry.svelte";
  import { ui, type PanelGroupLayout } from "$lib/stores/ui.svelte";
  import Icon from "./icons/Icon.svelte";
  import Popover from "./controls/Popover.svelte";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  const registered = $derived(getPanels("right"));

  // Place every registered panel in the workspace (idempotent).
  $effect(() => {
    const list = registered;
    untrack(() => {
      for (const p of list) ui.placePanel(p.id, p.group ?? null, (p.preferredSize ?? 300) / 300);
    });
  });

  interface GroupView {
    layout: PanelGroupLayout;
    panels: PanelDef[];
    active: PanelDef | null;
  }
  const groups = $derived.by((): GroupView[] =>
    ui.workspace.groups
      .map((g) => {
        const panels = g.panels.map((id) => getPanel(id)).filter((p): p is PanelDef => !!p && ui.isPanelVisible(p.id));
        const active = panels.find((p) => p.id === g.active) ?? panels[0] ?? null;
        return { layout: g, panels, active };
      })
      .filter((g) => g.panels.length > 0),
  );

  // ---------------------------------------------------------------- width drag
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

  // ---------------------------------------------------------------- divider drag
  let dock = $state<HTMLElement | null>(null);
  function startDividerDrag(e: PointerEvent, above: GroupView, below: GroupView) {
    if (!dock) return;
    const startY = e.clientY;
    const wa = above.layout.weight;
    const wb = below.layout.weight;
    const total = wa + wb;
    const aEl = dock.querySelector<HTMLElement>(`[data-group="${above.layout.id}"]`);
    const bEl = dock.querySelector<HTMLElement>(`[data-group="${below.layout.id}"]`);
    const px = (aEl?.offsetHeight ?? 150) + (bEl?.offsetHeight ?? 150);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => ui.setPairWeights(above.layout.id, below.layout.id, wa / total + (ev.clientY - startY) / Math.max(1, px));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  // ---------------------------------------------------------------- tab drag (pointer based)
  let drag = $state<{ panelId: string; x: number; y: number; over: string | null; index: number } | null>(null);
  function startTabDrag(e: PointerEvent, p: PanelDef) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-strip], [data-newgroup]");
      let over: string | null = null;
      let index = Number.MAX_SAFE_INTEGER;
      if (target?.dataset.strip) {
        over = target.dataset.strip;
        const tabs = [...target.querySelectorAll<HTMLElement>("[data-tab]")];
        index = tabs.length;
        for (let i = 0; i < tabs.length; i++) {
          const r = tabs[i]!.getBoundingClientRect();
          if (ev.clientX < r.left + r.width / 2) {
            index = i;
            break;
          }
        }
      } else if (target?.dataset.newgroup !== undefined) over = "__new__";
      drag = { panelId: p.id, x: ev.clientX, y: ev.clientY, over, index };
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const d = drag;
      drag = null;
      if (!started) {
        ui.activateTab(p.id);
        return;
      }
      if (!d?.over) return;
      ui.movePanel(p.id, d.over === "__new__" ? null : d.over, d.index);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  // ---------------------------------------------------------------- panel ≡ menu
  let menuFor = $state<string | null>(null);
  let menuAnchor = $state<HTMLElement | null>(null);
  function openMenu(g: GroupView, e: MouseEvent) {
    menuAnchor = e.currentTarget as HTMLElement;
    menuFor = menuFor === g.layout.id ? null : g.layout.id;
  }
  function menuItems(g: GroupView): { kind: "item"; c: CommandDef; disabled: boolean; checked: boolean }[] | [] {
    const items = g.active?.menu ?? [];
    return items.map((c) => ({ kind: "item" as const, c, disabled: c.enabled ? !c.enabled() : false, checked: c.checked ? c.checked() : false }));
  }
  function runMenu(c: CommandDef) {
    menuFor = null;
    void c.run();
  }
  function closeGroupPanel(g: GroupView) {
    menuFor = null;
    if (g.active) ui.togglePanel(g.active.id);
  }
  function iconOf(p: PanelDef): string | null {
    return typeof p.icon === "string" ? p.icon : null;
  }
  function iconComponent(p: PanelDef): Component<{ size?: number; strokeWidth?: number }> | null {
    return typeof p.icon === "string" || !p.icon ? null : (p.icon as Component<{ size?: number; strokeWidth?: number }>);
  }
</script>

<aside class="dock" class:iconized={ui.workspace.iconized} aria-label="Panels" bind:this={dock} style:width={ui.workspace.iconized ? "38px" : `${ui.dockWidth}px`}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="width-handle" onpointerdown={startWidthDrag}></div>
  <div class="dockhead">
    <button type="button" class="collapse" aria-label={ui.workspace.iconized ? "Expand panels" : "Collapse to icons"} data-tip={ui.workspace.iconized ? "Expand Panels" : "Collapse to Icons"} onclick={() => ui.setIconized(!ui.workspace.iconized)}>
      <Icon name={ui.workspace.iconized ? "collapse-left" : "collapse-right"} size={12} />
    </button>
  </div>

  {#if ui.workspace.iconized}
    <div class="iconstrip">
      {#each groups as g (g.layout.id)}
        <div class="igroup">
          {#each g.panels as p (p.id)}
            {@const Lucide = iconComponent(p)}
            <button type="button" class="ibtn" data-tip={p.title} aria-label={p.title} onclick={() => { ui.setIconized(false); ui.activateTab(p.id); }}>
              {#if iconOf(p)}<Icon name={iconOf(p)!} size={16} />{:else if Lucide}<Lucide size={16} strokeWidth={1.5} />{:else}<Icon name="document" size={16} />{/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    {#each groups as g, i (g.layout.id)}
      {@const prev = groups[i - 1]}
      {#if i > 0 && prev && !prev.layout.collapsed && !g.layout.collapsed}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="divider" onpointerdown={(e) => startDividerDrag(e, prev, g)}></div>
      {/if}
      <section class="group" class:collapsed={g.layout.collapsed} data-group={g.layout.id} style:flex={g.layout.collapsed ? "0 0 auto" : `${g.layout.weight} 1 0px`}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <header class="strip" class:dropping={drag?.over === g.layout.id} data-strip={g.layout.id} ondblclick={(e) => { if (!(e.target as HTMLElement).closest(".menu")) ui.toggleGroupCollapsed(g.layout.id); }}>
          {#if g.layout.collapsed}
            <div class="irow">
              {#each g.panels as p (p.id)}
                {@const Lucide = iconComponent(p)}
                <button type="button" class="ibtn" data-tip={p.title} aria-label={p.title} onclick={() => ui.activateTab(p.id)}>
                  {#if iconOf(p)}<Icon name={iconOf(p)!} size={16} />{:else if Lucide}<Lucide size={16} strokeWidth={1.5} />{:else}<Icon name="document" size={16} />{/if}
                </button>
              {/each}
            </div>
          {:else}
            <div class="tabs" role="tablist">
              {#each g.panels as p, ti (p.id)}
                {#if drag && drag.over === g.layout.id && drag.index === ti}<span class="ins"></span>{/if}
                <button type="button" role="tab" class="tab" class:on={g.active?.id === p.id} class:ghost={drag?.panelId === p.id} aria-selected={g.active?.id === p.id} data-tab={p.id} onpointerdown={(e) => startTabDrag(e, p)}>
                  {p.title}
                </button>
              {/each}
              {#if drag && drag.over === g.layout.id && drag.index >= g.panels.length}<span class="ins"></span>{/if}
            </div>
          {/if}
          <button type="button" class="menu" aria-label="Panel menu" data-tip="Panel menu" onclick={(e) => openMenu(g, e)}>
            <Icon name="panel-menu" size={14} />
          </button>
        </header>
        {#if !g.layout.collapsed && g.active}
          <div class="body">
            <g.active.component />
          </div>
        {/if}
      </section>
    {:else}
      <div class="empty">All panels are hidden. Use the Window menu to show them.</div>
    {/each}
    {#if drag}
      <div class="newzone" class:dropping={drag.over === "__new__"} data-newgroup>Drop here for a new group</div>
    {/if}
  {/if}

  {#if drag}
    <div class="dragghost" style:left="{drag.x + 8}px" style:top="{drag.y + 8}px">{getPanel(drag.panelId)?.title}</div>
  {/if}

  <Popover anchor={menuAnchor} open={menuFor !== null} onclose={() => (menuFor = null)} align="right" minWidth={200}>
    {@const g = groups.find((x) => x.layout.id === menuFor)}
    {#if g}
      <div class="pmenu" role="menu">
        {#each menuItems(g) as it (it.c.id)}
          <button type="button" role="menuitem" class="pitem" disabled={it.disabled} onclick={() => runMenu(it.c)}>
            <span class="pchk">{#if it.checked}<Icon name="check" size={12} />{/if}</span>
            <span class="plabel">{it.c.label}</span>
            {#if it.c.shortcut}<span class="psc">{formatShortcut(it.c.shortcut, IS_MAC)}</span>{/if}
          </button>
        {/each}
        {#if menuItems(g).length}<div class="psep"></div>{/if}
        <button type="button" role="menuitem" class="pitem" onclick={() => { menuFor = null; ui.toggleGroupCollapsed(g.layout.id); }}>
          <span class="pchk"></span><span class="plabel">{g.layout.collapsed ? "Expand Panel" : "Collapse to Icons"}</span>
        </button>
        <button type="button" role="menuitem" class="pitem" onclick={() => closeGroupPanel(g)}>
          <span class="pchk"></span><span class="plabel">Close</span>
        </button>
        <button type="button" role="menuitem" class="pitem" onclick={() => { menuFor = null; for (const p of g.panels) ui.togglePanel(p.id); }}>
          <span class="pchk"></span><span class="plabel">Close Tab Group</span>
        </button>
      </div>
    {/if}
  </Popover>
</aside>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ps-canvas-bg);
    border-left: 1px solid var(--ps-border-dark);
    box-shadow: inset 1px 0 0 var(--ps-border-light);
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
  .iconized .width-handle {
    display: none;
  }
  .dockhead {
    flex: none;
    display: flex;
    justify-content: flex-end;
    height: 14px;
    background: var(--ps-panel-head);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .collapse {
    width: 24px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--ps-text-dim);
  }
  .collapse:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
  }
  .iconstrip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 0;
  }
  .igroup {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2px 0;
    background: var(--ps-app);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .irow {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
  }
  .ibtn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .ibtn:hover {
    background: var(--ps-hover);
  }
  .divider {
    flex: none;
    height: 5px;
    margin: -2px 0;
    cursor: ns-resize;
    z-index: 4;
  }
  .divider:hover {
    background: var(--ps-accent);
    opacity: 0.6;
  }
  .group {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ps-panel);
    border-bottom: 1px solid var(--ps-border-dark);
    margin-bottom: 2px;
  }
  .group:not(.collapsed) {
    min-height: 72px;
  }
  .strip {
    flex: none;
    display: flex;
    align-items: stretch;
    height: 24px;
    background: var(--ps-panel-tab);
    border-bottom: 1px solid var(--ps-border-dark);
  }
  .strip.dropping {
    box-shadow: inset 0 0 0 1px var(--ps-accent);
  }
  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: stretch;
    overflow: hidden;
  }
  .tab {
    flex: none;
    padding: 0 9px;
    font-size: var(--fs-sm);
    color: var(--ps-text-dim);
    border-right: 1px solid var(--ps-border-dark);
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--ps-text);
  }
  .tab.on {
    background: var(--ps-panel-head);
    color: var(--ps-text);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .tab.ghost {
    opacity: 0.4;
  }
  .ins {
    width: 2px;
    background: var(--ps-accent);
    margin: 3px 0;
  }
  .menu {
    width: 22px;
    display: grid;
    place-items: center;
    color: var(--ps-text-dim);
    margin-left: auto;
    border-left: 1px solid var(--ps-border-dark);
  }
  .menu:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
  }
  .body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden auto;
    background: var(--ps-panel);
  }
  .empty {
    padding: 12px;
    color: var(--ps-text-dim);
    font-size: var(--fs-sm);
  }
  .newzone {
    /* Overlay at the bottom of the dock: showing it must not reflow the groups (the
       drop targets would jump away from the cursor mid-drag). */
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 4px;
    z-index: 5;
    background: var(--ps-panel);
    padding: 8px;
    text-align: center;
    border: 1px dashed var(--ps-border-light);
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .newzone.dropping {
    border-color: var(--ps-accent);
    color: var(--ps-text);
  }
  .dragghost {
    position: fixed;
    z-index: 900;
    padding: 2px 8px;
    background: var(--ps-panel-head);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
    font-size: var(--fs-sm);
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .pmenu {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .pitem {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 12px 0 4px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .pitem:hover:not(:disabled) {
    background: var(--ps-row-selected);
  }
  .pitem:disabled {
    color: var(--ps-text-disabled);
  }
  .pchk {
    display: grid;
    width: 16px;
    place-items: center;
  }
  .plabel {
    flex: 1;
    padding-right: 24px;
  }
  .psc {
    color: var(--ps-text-dim);
  }
  .psep {
    height: 1px;
    margin: 3px 0;
    background: var(--ps-border-dark);
    box-shadow: 0 1px 0 var(--ps-border-light);
  }
</style>
