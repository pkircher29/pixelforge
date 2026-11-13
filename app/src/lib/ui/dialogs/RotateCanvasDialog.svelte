<script lang="ts">
  /** Image > Rotate > Arbitrary: rotate the whole canvas by any angle. */
  import { docStore } from "$lib/stores/doc.svelte";
  import { RotateCanvasCommand, rotateCanvasBounds } from "$lib/filters/transform/commands";
  import Dialog from "./Dialog.svelte";

  interface Props {
    resolve: (r: null) => void;
  }
  let { resolve }: Props = $props();

  const onclose = (): void => resolve(null);
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
</script>

<Dialog title="Rotate Canvas" oncancel={onclose} onsubmit={ok} dim={false} width={320}>
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
    <button class="btn primary" type="button" onclick={ok} disabled={!valid}>OK</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 8px 10px;
  }
  .name {
    color: var(--ps-text-dim);
  }
  .angle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .field {
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--ps-text);
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    padding: 4px 8px;
    width: 100px;
  }
  .field:focus {
    outline: none;
    border-color: var(--ps-focus);
  }
  .unit {
    color: var(--ps-text-dim);
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    justify-self: start;
  }
  .segmented button {
    padding: 3px 10px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .segmented button.on {
    background: var(--ps-active);
    color: var(--ps-text-bright);
  }
  .result {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--ps-divider);
    color: var(--ps-text-dim);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-xs);
  }
  .grow {
    flex: 1;
  }
  .btn {
    padding: 4px 12px;
    border-radius: 2px;
    background: var(--ps-raised);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
  }
  .btn:hover {
    background: var(--ps-hover);
  }
  .btn.primary {
    background: var(--ps-accent);
    border-color: var(--ps-accent);
    color: #fff;
  }
  .btn:disabled {
    opacity: 0.5;
  }
</style>
