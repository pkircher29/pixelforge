<script lang="ts">
  /** Image > Canvas Size: grow or crop the canvas without scaling, anchored on a 3x3 grid. */
  import { MAX_CANVAS_SIZE, ResizeCanvasCommand, type CanvasAnchor } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import Modal from "$lib/filters/ui/Modal.svelte";

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  const doc = docStore.doc;
  const w0 = doc?.width ?? 1;
  const h0 = doc?.height ?? 1;

  let relative = $state(false);
  let unit = $state<"px" | "%">("px");
  let width = $state(w0);
  let height = $state(h0);
  let anchor = $state<CanvasAnchor>({ x: 0.5, y: 0.5 });

  const ANCHORS: CanvasAnchor[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
    { x: 0.5, y: 1 },
    { x: 1, y: 1 },
  ];

  function toPx(v: number, base: number): number {
    const px = unit === "px" ? v : (v * base) / 100;
    return Math.round(relative ? base + px : px);
  }
  const pxW = $derived(toPx(width, w0));
  const pxH = $derived(toPx(height, h0));
  const valid = $derived(pxW >= 1 && pxH >= 1 && pxW <= MAX_CANVAS_SIZE && pxH <= MAX_CANVAS_SIZE);
  const changed = $derived(pxW !== w0 || pxH !== h0);
  const crops = $derived(pxW < w0 || pxH < h0);

  function setRelative(r: boolean): void {
    if (r === relative) return;
    relative = r;
    width = r ? 0 : unit === "px" ? w0 : 100;
    height = r ? 0 : unit === "px" ? h0 : 100;
  }
  function setUnit(u: "px" | "%"): void {
    if (u === unit) return;
    unit = u;
    width = relative ? 0 : u === "px" ? w0 : 100;
    height = relative ? 0 : u === "px" ? h0 : 100;
  }

  function ok(): void {
    if (!valid) return;
    if (changed) docStore.exec(new ResizeCanvasCommand(pxW, pxH, $state.snapshot(anchor)));
    onclose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    } else if (e.key === "Enter") {
      e.stopPropagation();
      ok();
    }
  }

  /** Arrow glyph in cell `cell` pointing away from the selected anchor (where new space appears). */
  function arrow(cell: CanvasAnchor, from: CanvasAnchor): string {
    const dx = cell.x - from.x;
    const dy = cell.y - from.y;
    if (dx === 0 && dy === 0) return "•";
    const dirs: Record<string, string> = {
      "0,-1": "↑",
      "1,-1": "↗",
      "1,0": "→",
      "1,1": "↘",
      "0,1": "↓",
      "-1,1": "↙",
      "-1,0": "←",
      "-1,-1": "↖",
    };
    return dirs[`${Math.sign(dx)},${Math.sign(dy)}`] ?? "•";
  }
</script>

<svelte:window onkeydown={onKey} />

<Modal title="Canvas Size" {onclose} width={340}>
  <p class="current mono">Current: {w0} × {h0} px</p>
  <div class="grid">
    <span class="name">Width</span>
    <input class="field" type="number" step={unit === "%" ? 0.01 : 1} bind:value={width} />
    <span class="name">Height</span>
    <input class="field" type="number" step={unit === "%" ? 0.01 : 1} bind:value={height} />
    <span class="name">Units</span>
    <div class="segmented">
      <button type="button" class:on={unit === "px"} onclick={() => setUnit("px")}>pixels</button>
      <button type="button" class:on={unit === "%"} onclick={() => setUnit("%")}>percent</button>
    </div>
  </div>
  <label class="check">
    <input type="checkbox" checked={relative} onchange={(e) => setRelative(e.currentTarget.checked)} />
    <span>Relative (add or remove from the current size)</span>
  </label>
  <div class="anchor-row">
    <span class="name">Anchor</span>
    <div class="anchor" role="radiogroup" aria-label="Anchor">
      {#each ANCHORS as a (`${a.x},${a.y}`)}
        <button
          type="button"
          role="radio"
          aria-checked={anchor.x === a.x && anchor.y === a.y}
          class:on={anchor.x === a.x && anchor.y === a.y}
          onclick={() => (anchor = { x: a.x, y: a.y })}
          title="Anchor {a.y === 0 ? 'top' : a.y === 1 ? 'bottom' : 'middle'} {a.x === 0 ? 'left' : a.x === 1 ? 'right' : 'centre'}"
        >
          <span class="hint">{arrow(a, anchor)}</span>
        </button>
      {/each}
    </div>
  </div>
  <p class="result mono">
    New size: {pxW} × {pxH} px
    {#if crops}<span class="warn">· pixels outside the new canvas are discarded</span>{/if}
  </p>
  {#if !valid}
    <p class="problem">Each side must be between 1 and {MAX_CANVAS_SIZE} pixels.</p>
  {/if}
  {#snippet footer()}
    <span class="grow"></span>
    <button class="btn" type="button" onclick={onclose}>Cancel</button>
    <button class="btn primary" type="button" onclick={ok} disabled={!valid}>Apply</button>
  {/snippet}
</Modal>

<style>
  .current {
    margin: 0;
    color: var(--fg-2);
  }
  .grid {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 8px 10px;
  }
  .name {
    color: var(--fg-1);
  }
  .field {
    font: inherit;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    width: 100%;
  }
  .field:focus {
    outline: none;
    border-color: var(--accent);
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    justify-self: start;
  }
  .segmented button {
    padding: 3px 10px;
    border-radius: 6px;
    color: var(--fg-1);
  }
  .segmented button.on {
    background: var(--bg-3);
    color: var(--fg-0);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--fg-1);
  }
  .check input {
    accent-color: var(--accent);
    margin: 0;
  }
  .anchor-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 10px;
    align-items: start;
  }
  .anchor {
    display: grid;
    grid-template-columns: repeat(3, 30px);
    grid-auto-rows: 30px;
    gap: 3px;
  }
  .anchor button {
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--fg-2);
    font-size: 14px;
  }
  .anchor button:hover {
    border-color: var(--border-strong);
    color: var(--fg-0);
  }
  .anchor button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--fg-0);
    font-size: 18px;
  }
  .hint {
    pointer-events: none;
  }
  .result {
    margin: 0;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    color: var(--fg-1);
  }
  .warn {
    color: var(--fg-2);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .problem {
    margin: 0;
    color: var(--danger);
  }
  .grow {
    flex: 1;
  }
  .btn {
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    color: var(--fg-0);
  }
  .btn:hover {
    background: var(--bg-3);
  }
  .btn.primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }
  .btn:disabled {
    opacity: 0.5;
  }
</style>
