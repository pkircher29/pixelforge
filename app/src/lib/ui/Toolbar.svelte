<script lang="ts">
  /**
   * Photoshop single-column toolbar: 24 px buttons with a fly-out triangle, long-press
   * (300 ms) or right-click opens the fly-out (icon · name · key, current one checked),
   * the last-used tool becomes the group's face. Below: fg/bg swatches with default (D)
   * and swap (X) mini glyphs, Quick Mask (Q), Screen Mode (F).
   */
  import { toolStore, rgbaToHex } from "$lib/stores/tool.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { toolbarSlots, toolGlyph, type ToolbarSlot, type ToolSlotMember } from "$lib/tools";
  import { canvasHost } from "./canvas/host.svelte";
  import Icon from "./icons/Icon.svelte";
  import { runCommand } from "./registry.svelte";

  const LONG_PRESS_MS = 300;
  const slots = toolbarSlots();
  let flyout = $state<string | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressedSlot: string | null = null;
  let pressFiredFlyout = false;
  let flyoutTop = $state(0);
  let bar = $state<HTMLElement | null>(null);

  const double = $derived(settings.value.toolbarDoubleColumn === true);

  function face(slot: ToolbarSlot): ToolSlotMember {
    const ids = slot.members.map((m) => m.id);
    const firstLive = slot.members.find((m) => m.tool)?.id ?? slot.members[0]!.id;
    const id = toolStore.faceOf(slot.id, ids, firstLive);
    return slot.members.find((m) => m.id === id) ?? slot.members[0]!;
  }
  function isActive(slot: ToolbarSlot): boolean {
    return slot.members.some((m) => m.id === toolStore.activeToolId);
  }
  function select(slot: ToolbarSlot, m: ToolSlotMember) {
    flyout = null;
    if (!m.tool) return;
    toolStore.lastInGroup[slot.id] = m.id;
    canvasHost.activateTool(m.id);
  }
  function openFlyout(slot: ToolbarSlot, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const barR = bar?.getBoundingClientRect();
    flyoutTop = r.top - (barR?.top ?? 0);
    flyout = slot.id;
  }

  function onDown(slot: ToolbarSlot, e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    pressFiredFlyout = false;
    if (e.button === 2) {
      openFlyout(slot, el);
      return;
    }
    if (e.button !== 0) return;
    pressedSlot = slot.id;
    if (slot.members.length > 1) {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        pressFiredFlyout = true;
        openFlyout(slot, el);
      }, LONG_PRESS_MS);
    }
  }
  function onUp(slot: ToolbarSlot, e: PointerEvent) {
    if (e.button !== 0 || pressedSlot !== slot.id) return;
    pressedSlot = null;
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (!pressFiredFlyout) select(slot, face(slot));
  }
  function onLeave() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressedSlot = null;
  }
  function onWindowDown(e: PointerEvent) {
    if (flyout && !(e.target as HTMLElement).closest(".flyout, .slot")) flyout = null;
  }
  function onWindowKey(e: KeyboardEvent) {
    if (flyout && e.key === "Escape") flyout = null;
  }

  /** A member's own key (Rotate View = R inside the Hand slot), else the slot's. */
  function memberKey(m: ToolSlotMember, slot: ToolbarSlot): string {
    return m.tool?.shortcut || slot.key;
  }
  function tip(m: ToolSlotMember, key: string): string {
    return key ? `${m.name} (${key})` : m.name;
  }
  const screenTip = $derived(
    toolStore.screenMode === "standard" ? "Standard Screen Mode (F)" : toolStore.screenMode === "fullscreen-menu" ? "Full Screen Mode With Menu Bar (F)" : "Full Screen Mode (F)",
  );
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={onWindowKey} />

<aside class="toolbar" class:double class:flyopen={!!flyout} aria-label="Tools" bind:this={bar}>
  <div class="grip" aria-hidden="true"><Icon name="grip" size={12} /></div>
  <div class="tools">
    {#each slots as slot (slot.id)}
      {@const m = face(slot)}
      {@const active = isActive(slot)}
      <div class="slot">
        <button
          type="button"
          class="tool"
          class:active
          class:group={slot.members.length > 1}
          class:placeholder={!m.tool}
          data-tip={tip(m, memberKey(m, slot))}
          aria-label={m.name}
          aria-pressed={active}
          disabled={!m.tool && slot.tools.length === 0}
          onpointerdown={(e) => onDown(slot, e)}
          onpointerup={(e) => onUp(slot, e)}
          onpointerleave={onLeave}
          oncontextmenu={(e) => e.preventDefault()}
        >
          <Icon name={m.glyph ?? toolGlyph(m.id, m.tool)} size={16} />
        </button>
      </div>
    {/each}
  </div>

  {#if flyout}
    {@const slot = slots.find((s) => s.id === flyout)}
    {#if slot}
      <div class="flyout ps-popup" role="menu" style:top="{flyoutTop}px">
        {#each slot.members as fm (fm.id)}
          {@const on = fm.id === toolStore.activeToolId}
          <button type="button" role="menuitemradio" aria-checked={on} class="fly" class:on class:dead={!fm.tool} disabled={!fm.tool} onclick={() => select(slot, fm)}>
            <span class="fchk">{#if on}<Icon name="check" size={12} />{/if}</span>
            <span class="fic"><Icon name={fm.glyph ?? toolGlyph(fm.id, fm.tool)} size={16} /></span>
            <span class="fname">{fm.name}</span>
            <span class="fkey">{memberKey(fm, slot)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  <div class="grow"></div>

  <div class="colors">
    <button type="button" class="mini default" data-tip="Default Foreground and Background Colors (D)" aria-label="Default colors" onclick={() => toolStore.resetColors()}>
      <Icon name="default-colors" size={11} />
    </button>
    <button type="button" class="mini swap" data-tip="Switch Foreground and Background Colors (X)" aria-label="Swap colors" onclick={() => toolStore.swap()}>
      <Icon name="swap-colors" size={11} />
    </button>
    <!-- PS: clicking a swatch opens the Color Picker dialog (not the OS picker). -->
    <button type="button" class="sw bg" data-tip="Set background color" aria-label="Background color" style:background={rgbaToHex(toolStore.bg)} onclick={() => void runCommand("color.pickBackground")}></button>
    <button type="button" class="sw fg" data-tip="Set foreground color" aria-label="Foreground color" style:background={rgbaToHex(toolStore.fg)} onclick={() => void runCommand("color.pick")}></button>
  </div>

  <div class="modes">
    <button type="button" class="tool" class:active={toolStore.quickMask} data-tip={toolStore.quickMask ? "Edit in Standard Mode (Q)" : "Edit in Quick Mask Mode (Q)"} aria-label="Quick Mask" aria-pressed={toolStore.quickMask} onclick={() => toolStore.toggleQuickMask()}>
      <Icon name={toolStore.quickMask ? "quick-mask-on" : "quick-mask"} size={16} />
    </button>
    <button type="button" class="tool group" data-tip={screenTip} aria-label="Screen mode" onclick={() => toolStore.cycleScreenMode()}>
      <Icon name={toolStore.screenMode === "standard" ? "screen-mode" : toolStore.screenMode === "fullscreen-menu" ? "screen-mode-menubar" : "screen-mode-full"} size={16} />
    </button>
  </div>
</aside>

<style>
  .toolbar {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: var(--toolbar-w);
    padding: 0 0 4px;
    background: var(--ps-app);
    border-right: 1px solid var(--ps-border-dark);
    box-shadow: inset -1px 0 0 var(--ps-border-light);
    overflow: visible;
    z-index: 20;
  }
  .toolbar.double {
    width: 60px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 100%;
    height: 10px;
    color: var(--ps-text-disabled);
    margin-bottom: 2px;
  }
  .grip :global(svg) {
    transform: rotate(90deg);
  }
  .tools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
  .double .tools {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    width: 56px;
  }
  .slot {
    position: relative;
  }
  .tool {
    position: relative;
    width: 28px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 2px;
    color: var(--ps-text);
  }
  .tool:hover:not(:disabled) {
    background: var(--ps-hover);
  }
  .tool.active {
    background: var(--ps-row-selected);
    box-shadow: inset 0 0 0 1px var(--ps-border-dark);
  }
  .tool.placeholder,
  .tool:disabled {
    color: var(--ps-text-disabled);
  }
  /* ::before, because ::after is the shared tooltip pseudo-element (data-tip). */
  .tool.group::before {
    content: "";
    position: absolute;
    right: 2px;
    bottom: 2px;
    border: 2.5px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
  }
  /* PS hides the tool tooltip while a fly-out is open. */
  .toolbar.flyopen :global([data-tip]::after) {
    display: none;
  }
  .flyout {
    position: absolute;
    left: calc(100% + 2px);
    z-index: 70;
    padding: 3px 0;
    min-width: 232px;
  }
  .fly {
    display: grid;
    grid-template-columns: 16px 22px 1fr auto;
    align-items: center;
    gap: 2px;
    width: 100%;
    height: 24px;
    padding: 0 10px 0 4px;
    font-size: var(--fs-sm);
    color: var(--ps-text);
    text-align: left;
    white-space: nowrap;
  }
  .fly:hover:not(:disabled),
  .fly.on {
    background: var(--ps-row-selected);
  }
  .fly.dead {
    color: var(--ps-text-disabled);
  }
  .fchk,
  .fic {
    display: grid;
    place-items: center;
  }
  .fname {
    padding-left: 4px;
  }
  .fkey {
    color: var(--ps-text-dim);
    padding-left: 16px;
  }
  .grow {
    flex: 1;
  }
  .colors {
    position: relative;
    width: 28px;
    height: 30px;
    margin: 4px 0 2px;
  }
  .mini {
    position: absolute;
    display: grid;
    place-items: center;
    width: 12px;
    height: 12px;
    color: var(--ps-text-dim);
    border-radius: 2px;
  }
  .mini:hover {
    color: var(--ps-text);
  }
  .mini.default {
    left: 0;
    bottom: 0;
  }
  .mini.swap {
    right: 0;
    top: 0;
  }
  .sw {
    position: absolute;
    width: 17px;
    height: 17px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55);
    overflow: hidden;
  }
  .sw {
    padding: 0;
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
  .modes {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding-top: 4px;
    margin-top: 2px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: 0 -1px 0 var(--ps-border-light);
    width: 24px;
  }
</style>
