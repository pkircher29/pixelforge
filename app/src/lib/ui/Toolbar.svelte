<script lang="ts">
  /** Left toolbar: one button per slot, fly-outs for grouped tools, colour swatches. */
  import { ArrowLeftRight, RotateCcw } from "@lucide/svelte";
  import { toolStore, rgbaToHex, hexToRgba } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { toolbarSlots, type Tool } from "$lib/tools";
  import { canvasHost } from "./canvas/host.svelte";
  import { formatShortcut, IS_MAC } from "$lib/shortcuts";

  const slots = toolbarSlots();
  let flyout = $state<string | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  function shownTool(slot: { id: string; tools: Tool[] }): Tool {
    const active = slot.tools.find((t) => t.id === toolStore.activeToolId);
    if (active) return active;
    const chosen = ui.toolbarFlyoutChoice[slot.id];
    return slot.tools.find((t) => t.id === chosen) ?? slot.tools[0]!;
  }

  function select(slot: { id: string; tools: Tool[] }, t: Tool) {
    if (slot.tools.length > 1) ui.setFlyoutChoice(slot.id, t.id);
    canvasHost.activateTool(t.id);
    flyout = null;
  }

  function onDown(slot: { id: string; tools: Tool[] }, e: PointerEvent) {
    if (e.button === 2 || (e.button === 0 && slot.tools.length > 1)) {
      pressTimer = setTimeout(() => {
        flyout = slot.id;
        pressTimer = null;
      }, e.button === 2 ? 0 : 320);
    }
  }
  function onUp(slot: { id: string; tools: Tool[] }, e: PointerEvent) {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
      if (e.button === 0) select(slot, shownTool(slot));
    }
  }
  function onWindowDown(e: PointerEvent) {
    if (flyout && !(e.target as HTMLElement).closest(".flyout, .slot")) flyout = null;
  }

  function tip(t: Tool): string {
    return `${t.name}  ${formatShortcut(t.shortcut, IS_MAC)}`;
  }
</script>

<svelte:window onpointerdown={onWindowDown} />

<aside class="toolbar" aria-label="Tools">
  {#each slots as slot (slot.id)}
    {@const t = shownTool(slot)}
    {@const active = slot.tools.some((x) => x.id === toolStore.activeToolId)}
    <div class="slot">
      <button
        type="button"
        class="tool"
        class:active
        class:group={slot.tools.length > 1}
        data-tip={tip(t)}
        aria-label={t.name}
        aria-pressed={active}
        onpointerdown={(e) => onDown(slot, e)}
        onpointerup={(e) => onUp(slot, e)}
        onclick={() => slot.tools.length === 1 && select(slot, t)}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <t.icon size={18} strokeWidth={1.75} />
      </button>
      {#if flyout === slot.id}
        <div class="flyout glass" role="menu">
          {#each slot.tools as ft (ft.id)}
            <button type="button" role="menuitem" class="fly" class:on={ft.id === toolStore.activeToolId} onclick={() => select(slot, ft)}>
              <ft.icon size={16} strokeWidth={1.75} />
              <span>{ft.name}</span>
              <kbd>{formatShortcut(ft.shortcut, IS_MAC)}</kbd>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  <div class="grow"></div>

  <div class="colors">
    <button type="button" class="mini" data-tip="Swap colours  X" aria-label="Swap colours" onclick={() => toolStore.swap()}>
      <ArrowLeftRight size={11} />
    </button>
    <div class="swatches">
      <label class="sw bg" data-tip="Background colour" style:background={rgbaToHex(toolStore.bg)}>
        <input type="color" value={rgbaToHex(toolStore.bg)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) toolStore.setBg(c); }} aria-label="Background colour" />
      </label>
      <label class="sw fg" data-tip="Foreground colour" style:background={rgbaToHex(toolStore.fg)}>
        <input type="color" value={rgbaToHex(toolStore.fg)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) toolStore.setFg(c); }} aria-label="Foreground colour" />
      </label>
    </div>
    <button type="button" class="mini" data-tip="Default colours  D" aria-label="Default colours" onclick={() => toolStore.resetColors()}>
      <RotateCcw size={11} />
    </button>
  </div>
</aside>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 6px 0;
    background: var(--bg-1);
    border-right: 1px solid var(--border);
    overflow: visible;
    z-index: 20;
  }
  .slot {
    position: relative;
  }
  .tool {
    position: relative;
    width: 34px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    color: var(--fg-1);
    transition: background var(--t-fast) ease-out, color var(--t-fast) ease-out, box-shadow var(--t-fast) ease-out;
  }
  .tool:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .tool.active {
    background: var(--accent-soft);
    color: var(--accent-2);
    box-shadow: inset 0 0 0 1px rgba(139, 108, 255, 0.5), 0 0 12px rgba(139, 108, 255, 0.25);
  }
  /* ::before, because ::after is the shared tooltip pseudo-element (data-tip). */
  .tool.group::before {
    content: "";
    position: absolute;
    right: 4px;
    bottom: 4px;
    border: 3px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
    opacity: 0.6;
  }
  .flyout {
    position: absolute;
    left: calc(100% + 6px);
    top: 0;
    z-index: 70;
    padding: 4px;
    min-width: 200px;
  }
  .fly {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--fg-0);
    text-align: left;
  }
  .fly:hover,
  .fly.on {
    background: var(--accent-soft);
  }
  .fly kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-2);
  }
  .grow {
    flex: 1;
  }
  .colors {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }
  .mini {
    width: 20px;
    height: 16px;
    display: grid;
    place-items: center;
    color: var(--fg-2);
    border-radius: 3px;
  }
  .mini:hover {
    color: var(--fg-0);
    background: var(--bg-3);
  }
  .swatches {
    position: relative;
    width: 32px;
    height: 32px;
  }
  .sw {
    position: absolute;
    width: 21px;
    height: 21px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    cursor: pointer;
    overflow: hidden;
  }
  .sw input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .sw.bg {
    right: 0;
    bottom: 0;
  }
  .sw.fg {
    left: 0;
    top: 0;
    z-index: 1;
  }
</style>
