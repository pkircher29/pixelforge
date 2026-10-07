<script lang="ts">
  /** Image > Rotate > Arbitrary: rotate the whole canvas by any angle. */
  import { docStore } from "$lib/stores/doc.svelte";
  import { RotateCanvasCommand, rotateCanvasBounds } from "../transform/commands";
  import Modal from "./Modal.svelte";

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  const doc = docStore.doc;
  const w0 = doc?.width ?? 1;
  const h0 = doc?.height ?? 1;

  let angle = $state(15);
  let dir = $state<"cw" | "ccw">("cw");

  const signed = $derived(dir === "cw" ? angle : -angle);
  const bounds = $derived(rotateCanvasBounds(w0, h0, signed));
  const valid = $derived(Number.isFinite(angle) && angle > 0 && angle < 360);

  function ok(): void {
    if (!valid) return;
    docStore.exec(new RotateCanvasCommand(signed));
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
</script>

<svelte:window onkeydown={onKey} />

<Modal title="Rotate Canvas" {onclose} width={320}>
  <div class="grid">
    <span class="name">Angle</span>
    <div class="angle">
      <input class="field" type="number" min="0" max="359.99" step="0.1" bind:value={angle} />
      <span class="unit">°</span>
    </div>
    <span class="name">Direction</span>
    <div class="segmented">
      <button type="button" class:on={dir === "cw"} onclick={() => (dir = "cw")}>Clockwise</button>
      <button type="button" class:on={dir === "ccw"} onclick={() => (dir = "ccw")}>Counter-clockwise</button>
    </div>
  </div>
  <p class="result mono">Canvas grows to {bounds.w} × {bounds.h} px; new corners are transparent.</p>
  {#snippet footer()}
    <span class="grow"></span>
    <button class="btn" type="button" onclick={onclose}>Cancel</button>
    <button class="btn primary" type="button" onclick={ok} disabled={!valid}>Rotate</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px 10px;
  }
  .name {
    color: var(--fg-1);
  }
  .angle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .unit {
    color: var(--fg-2);
  }
  .field {
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    width: 100px;
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
  .result {
    margin: 0;
    color: var(--fg-2);
  }
  .mono {
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs);
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
