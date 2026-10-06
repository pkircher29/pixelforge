<script lang="ts">
  /**
   * PS "scrubby" numeric field: `Label: [ 100 ] %  ▾`. Drag the label to change the value
   * (Shift ×10, Alt ÷10), type in the field, ↑/↓ nudge, ▾ opens a slider popover.
   */
  import Popover from "./Popover.svelte";
  import Icon from "../icons/Icon.svelte";
  import { scrubValue, parseTyped, toSlider, fromSlider, nudge, formatNumber, type ScrubSpec } from "./scrubby";

  interface Props {
    label?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    log?: boolean;
    unit?: string;
    /** Show the ▾ slider popover (default true). */
    slider?: boolean;
    width?: number;
    disabled?: boolean;
    onchange: (v: number) => void;
    /** Fired continuously while dragging / sliding (defaults to onchange). */
    oninput?: (v: number) => void;
  }
  let { label, value, min, max, step = 1, log = false, unit, slider = true, width = 44, disabled = false, onchange, oninput }: Props = $props();

  const spec = $derived<ScrubSpec>({ min, max, step, log });
  let editing = $state(false);
  let text = $state("");
  let input = $state<HTMLInputElement | null>(null);
  let popOpen = $state(false);
  let chev = $state<HTMLButtonElement | null>(null);
  let dragging = $state(false);

  const live = (v: number) => (oninput ?? onchange)(v);

  function startScrub(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const start = value;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      dragging = true;
      live(scrubValue(start, dx, spec, { shift: ev.shiftKey, alt: ev.altKey }));
    };
    const upH = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", upH);
      el.removeEventListener("pointercancel", upH);
      dragging = false;
      if (moved) onchange(scrubValue(start, ev.clientX - startX, spec, { shift: ev.shiftKey, alt: ev.altKey }));
      else beginEdit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", upH);
    el.addEventListener("pointercancel", upH);
    e.preventDefault();
  }

  function beginEdit() {
    if (disabled) return;
    text = formatNumber(value);
    editing = true;
    queueMicrotask(() => input?.select());
  }
  function commit() {
    if (!editing) return;
    editing = false;
    const v = parseTyped(text, value, spec);
    if (v !== null && v !== value) onchange(v);
  }
  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") editing = false;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const v = nudge(parseTyped(text, value, spec) ?? value, e.key === "ArrowUp" ? 1 : -1, spec, e.shiftKey);
      text = formatNumber(v);
      onchange(v);
    }
  }
</script>

<span class="scrub" class:disabled class:dragging>
  {#if label}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="lbl" onpointerdown={startScrub} title="Drag to change">{label}:</span>
  {/if}
  <span class="field" style:width="{width}px">
    {#if editing}
      <input bind:this={input} bind:value={text} class="in" type="text" inputmode="decimal" onkeydown={onKey} onblur={commit} aria-label={label ?? "Value"} />
    {:else}
      <button type="button" class="val" onclick={beginEdit} {disabled} aria-label={label ?? "Value"}>{formatNumber(value)}{#if unit && unit === "%"}%{/if}</button>
    {/if}
  </span>
  {#if unit && unit !== "%"}<span class="unit">{unit}</span>{/if}
  {#if slider}
    <button type="button" class="chev" bind:this={chev} {disabled} aria-label="Slider" onclick={() => (popOpen = !popOpen)}><Icon name="caret-small" size={12} /></button>
    <Popover anchor={chev} open={popOpen} onclose={() => (popOpen = false)} minWidth={160}>
      <div class="slider">
        <input type="range" min="0" max="1000" step="1" value={toSlider(value, spec)} oninput={(e) => live(fromSlider(Number(e.currentTarget.value), spec))} onchange={(e) => onchange(fromSlider(Number(e.currentTarget.value), spec))} aria-label={label ?? "Value"} />
        <span class="sv">{formatNumber(value)}{unit === "%" ? "%" : ""}</span>
      </div>
    </Popover>
  {/if}
</span>

<style>
  .scrub {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: var(--row-h);
    white-space: nowrap;
  }
  .scrub.disabled {
    opacity: 0.5;
  }
  .lbl {
    color: var(--ps-text-dim);
    cursor: ew-resize;
    padding: 0 1px;
  }
  .dragging .lbl {
    color: var(--ps-text);
  }
  .field {
    display: inline-flex;
    height: var(--input-h);
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.25);
    border-radius: 2px;
  }
  .field:focus-within {
    border-color: var(--ps-accent);
  }
  .val,
  .in {
    width: 100%;
    height: 100%;
    padding: 0 3px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ps-text);
    background: none;
    border: 0;
    outline: none;
    font-size: var(--fs-sm);
    line-height: calc(var(--input-h) - 2px);
    user-select: text;
    -webkit-user-select: text;
  }
  .unit {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .chev {
    display: grid;
    place-items: center;
    width: 12px;
    height: var(--input-h);
    color: var(--ps-text-dim);
    border-radius: 2px;
  }
  .chev:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
  }
  .slider input {
    flex: 1;
  }
  .sv {
    min-width: 36px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
