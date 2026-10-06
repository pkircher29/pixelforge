<script lang="ts">
  /** Labelled range slider with a numeric field; the track fills from the param's zero. */
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    onchange: (v: number) => void;
  }

  let { label, value, min, max, step, unit = "", onchange }: Props = $props();

  const decimals = $derived(Math.max(0, Math.min(3, -Math.floor(Math.log10(step)))));
  const pct = $derived(((value - min) / (max - min)) * 100);
  const zeroPct = $derived(min < 0 && max > 0 ? ((0 - min) / (max - min)) * 100 : 0);
  const fillLeft = $derived(Math.min(pct, zeroPct));
  const fillWidth = $derived(Math.abs(pct - zeroPct));

  function clamp(v: number): number {
    if (!Number.isFinite(v)) return value;
    return Math.max(min, Math.min(max, v));
  }

  function onRange(e: Event): void {
    onchange(clamp(parseFloat((e.currentTarget as HTMLInputElement).value)));
  }

  function onNumber(e: Event): void {
    const el = e.currentTarget as HTMLInputElement;
    const v = clamp(parseFloat(el.value));
    el.value = v.toFixed(decimals);
    onchange(v);
  }

  function onKey(e: KeyboardEvent): void {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 1;
      const v = clamp(value + (e.key === "ArrowUp" ? step : -step) * mult);
      el.value = v.toFixed(decimals);
      onchange(v);
    }
  }
</script>

<label class="slider">
  <span class="name">{label}</span>
  <span class="track-wrap">
    <span class="fill" style:left="{fillLeft}%" style:width="{fillWidth}%"></span>
    <input class="range" type="range" {min} {max} {step} {value} oninput={onRange} />
  </span>
  <span class="num">
    <input
      class="field"
      type="number"
      {min}
      {max}
      {step}
      value={value.toFixed(decimals)}
      onchange={onNumber}
      onkeydown={onKey}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </span>
</label>

<style>
  .slider {
    display: grid;
    grid-template-columns: 96px 1fr 84px;
    align-items: center;
    gap: 10px;
    min-height: 26px;
  }
  .name {
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-wrap {
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }
  .fill {
    position: absolute;
    top: 9px;
    height: 2px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
    box-shadow: 0 0 6px rgba(124, 92, 255, 0.55);
  }
  .range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 20px;
    margin: 0;
    background: transparent;
    cursor: ew-resize;
  }
  .range::-webkit-slider-runnable-track {
    height: 2px;
    background: var(--bg-3);
    border-radius: 1px;
  }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -5px;
    border-radius: 50%;
    background: var(--fg-0);
    border: 2px solid var(--bg-1);
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .range:focus-visible::-webkit-slider-thumb {
    box-shadow: var(--glow-accent);
  }
  .num {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .field {
    width: 100%;
    min-width: 0;
    padding: 3px 6px;
    font: inherit;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .field::-webkit-inner-spin-button,
  .field::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .field:focus {
    outline: none;
    border-color: var(--accent);
  }
  .unit {
    color: var(--fg-2);
    font-size: var(--fs-xs);
    min-width: 14px;
  }
</style>
