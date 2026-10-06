<script lang="ts">
  /**
   * Self-contained floating dialog for the filters module.
   *
   * TODO(integration): swap for the shell's Dialog primitive once `ui-shell-tools` lands
   * it; keep the `title / onclose / children / footer` props so callers don't change.
   *
   * Non-dimming by design: the live preview on the canvas must stay fully visible, so the
   * backdrop only swallows pointer events. The panel is draggable by its title bar and
   * opens towards the right of the window where it covers the least canvas.
   */
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    onclose: () => void;
    width?: number;
    children: Snippet;
    footer?: Snippet;
  }

  let { title, onclose, width = 360, children, footer }: Props = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let x = $state(0);
  let y = $state(0);
  let placed = $state(false);

  $effect(() => {
    const el = panel;
    if (!el || placed) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Right third of the window, vertically comfortable; never off-screen.
    x = Math.max(12, Math.min(vw - r.width - 300, vw - r.width - 12));
    y = Math.max(52, Math.min(vh - r.height - 12, 96));
    placed = true;
  });

  let drag: { dx: number; dy: number } | null = null;
  function onTitleDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    drag = { dx: e.clientX - x, dy: e.clientY - y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onTitleMove(e: PointerEvent): void {
    if (!drag) return;
    x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
    y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
  }
  function onTitleUp(): void {
    drag = null;
  }
</script>

<div class="backdrop" role="presentation"></div>
<div
  class="panel"
  bind:this={panel}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  style:width="{width}px"
  style:left="{x}px"
  style:top="{y}px"
  style:visibility={placed ? "visible" : "hidden"}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -- drag handle only; the close button is the interactive control -->
  <div
    class="title"
    onpointerdown={onTitleDown}
    onpointermove={onTitleMove}
    onpointerup={onTitleUp}
    onpointercancel={onTitleUp}
  >
    <span class="title-text">{title}</span>
    <button class="close" type="button" aria-label="Close" onclick={onclose}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
  <div class="body">
    {@render children()}
  </div>
  {#if footer}
    <div class="footer">
      {@render footer()}
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    background: transparent;
  }
  .panel {
    position: fixed;
    z-index: 901;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 24px);
    background: rgba(18, 21, 28, 0.86);
    backdrop-filter: blur(18px) saturate(1.3);
    -webkit-backdrop-filter: blur(18px) saturate(1.3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      var(--shadow-2),
      0 0 0 1px rgba(124, 92, 255, 0.12);
    color: var(--fg-0);
    font-size: var(--fs-sm);
    outline: none;
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
    touch-action: none;
  }
  .title:active {
    cursor: grabbing;
  }
  .title-text {
    font-size: var(--fs-md);
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--fg-1);
  }
  .close:hover {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .body {
    padding: 12px 14px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border);
  }
</style>
