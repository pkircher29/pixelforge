<script lang="ts">
  /** PS angle dial: a circle with a radius line; drag to set the angle (Shift snaps to 15°). Altitude (optional) is the distance from the centre. */
  interface Props {
    value: number;
    altitude?: number;
    size?: number;
    disabled?: boolean;
    onchange: (angle: number, altitude?: number) => void;
  }
  let { value, altitude, size = 36, disabled = false, onchange }: Props = $props();

  const r = $derived(size / 2 - 2);
  const rad = $derived((value * Math.PI) / 180);
  const len = $derived(altitude === undefined ? r : r * (1 - altitude / 90) * 0.9 + 1);
  const x2 = $derived(size / 2 + Math.cos(rad) * len);
  const y2 = $derived(size / 2 - Math.sin(rad) * len);

  function set(e: PointerEvent, el: HTMLElement) {
    const b = el.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = b.top + b.height / 2 - e.clientY;
    let a = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    if (altitude === undefined) onchange(a);
    else {
      const d = Math.min(1, Math.hypot(dx, dy) / r);
      onchange(a, Math.round(Math.max(0, Math.min(90, (1 - d) * 90))));
    }
  }
  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    set(e, el);
    const move = (ev: PointerEvent) => set(ev, el);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg class="dial" class:disabled width={size} height={size} viewBox="0 0 {size} {size}" onpointerdown={down} aria-label="Angle">
  <circle cx={size / 2} cy={size / 2} r={r} />
  <line x1={size / 2} y1={size / 2} {x2} {y2} />
  <circle class="dot" cx={x2} cy={y2} r="1.6" />
</svg>

<style>
  .dial {
    display: block;
    cursor: crosshair;
  }
  .dial.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  circle {
    fill: var(--ps-input);
    stroke: var(--ps-border-light);
    stroke-width: 1;
  }
  line {
    stroke: var(--ps-text);
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .dot {
    fill: var(--ps-text);
    stroke: none;
  }
</style>
