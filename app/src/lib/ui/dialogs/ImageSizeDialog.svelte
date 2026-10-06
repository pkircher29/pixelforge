<script lang="ts">
  /** Image > Image Size: resample the whole document. */
  import { MAX_CANVAS_SIZE, ResizeImageCommand, type ResampleMethod } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import Modal from "$lib/filters/ui/Modal.svelte";

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  const doc = docStore.doc;
  const w0 = doc?.width ?? 1;
  const h0 = doc?.height ?? 1;
  const dpi = doc?.meta.dpi ?? 72;

  let unit = $state<"px" | "%">("px");
  let lock = $state(true);
  let method = $state<ResampleMethod>("bicubic");
  let width = $state(w0);
  let height = $state(h0);

  const pxW = $derived(unit === "px" ? Math.round(width) : Math.round((w0 * width) / 100));
  const pxH = $derived(unit === "px" ? Math.round(height) : Math.round((h0 * height) / 100));
  const valid = $derived(pxW >= 1 && pxH >= 1 && pxW <= MAX_CANVAS_SIZE && pxH <= MAX_CANVAS_SIZE);
  const changed = $derived(pxW !== w0 || pxH !== h0);
  const bytes = $derived(pxW * pxH * 4 * (doc?.layers.filter((l) => l.kind === "raster").length ?? 1));
  const printW = $derived((pxW / dpi).toFixed(2));
  const printH = $derived((pxH / dpi).toFixed(2));

  function setUnit(u: "px" | "%"): void {
    if (u === unit) return;
    if (u === "%") {
      width = +((pxW / w0) * 100).toFixed(2);
      height = +((pxH / h0) * 100).toFixed(2);
    } else {
      width = pxW;
      height = pxH;
    }
    unit = u;
  }

  function onWidth(e: Event): void {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    width = v;
    if (lock) height = unit === "%" ? v : Math.max(1, Math.round((v * h0) / w0));
  }

  function onHeight(e: Event): void {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    height = v;
    if (lock) width = unit === "%" ? v : Math.max(1, Math.round((v * w0) / h0));
  }

  function ok(): void {
    if (!valid) return;
    if (changed) docStore.exec(new ResizeImageCommand(pxW, pxH, method));
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

  function fmtBytes(n: number): string {
    return n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
  }
</script>

<svelte:window onkeydown={onKey} />

<Modal title="Image Size" {onclose} width={340}>
  <div class="grid">
    <span class="name">Width</span>
    <input class="field" type="number" min="1" step={unit === "%" ? 0.01 : 1} value={width} oninput={onWidth} />
    <span class="name">Height</span>
    <input class="field" type="number" min="1" step={unit === "%" ? 0.01 : 1} value={height} oninput={onHeight} />
    <span class="name">Units</span>
    <div class="segmented">
      <button type="button" class:on={unit === "px"} onclick={() => setUnit("px")}>pixels</button>
      <button type="button" class:on={unit === "%"} onclick={() => setUnit("%")}>percent</button>
    </div>
    <span class="name">Resample</span>
    <select bind:value={method}>
      <option value="bicubic">Bicubic (smooth)</option>
      <option value="bilinear">Bilinear</option>
      <option value="nearest">Nearest neighbour (hard edges)</option>
    </select>
  </div>
  <label class="check">
    <input type="checkbox" bind:checked={lock} />
    <span>Keep proportions</span>
  </label>
  <dl class="info">
    <dt>New size</dt>
    <dd class="mono">{pxW} × {pxH} px · {fmtBytes(bytes)}</dd>
    <dt>Print size</dt>
    <dd class="mono">{printW} × {printH} in at {dpi} dpi</dd>
  </dl>
  {#if !valid}
    <p class="problem">Each side must be between 1 and {MAX_CANVAS_SIZE} pixels.</p>
  {/if}
  {#snippet footer()}
    <span class="grow"></span>
    <button class="btn" type="button" onclick={onclose}>Cancel</button>
    <button class="btn primary" type="button" onclick={ok} disabled={!valid}>Resize</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 8px 10px;
  }
  .name {
    color: var(--fg-1);
  }
  .field,
  select {
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
  select {
    font-family: var(--font-ui);
  }
  .field:focus,
  select:focus {
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
  .info {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 4px 10px;
    margin: 0;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    color: var(--fg-2);
  }
  .info dd {
    margin: 0;
    color: var(--fg-1);
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
