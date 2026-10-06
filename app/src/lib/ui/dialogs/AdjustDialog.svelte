<script lang="ts">
  /**
   * Generic adjustment / filter dialog driven by `OpDef.params`.
   *
   * Live preview: on every param change (debounced to a frame) the original pixels of the
   * dirty rect are restored into the layer, the op is re-run from them and the result is
   * written back + `docStore.touch`ed. Cancel restores the originals; OK restores them
   * and pushes one `ReplaceLayerPixelsCommand` so undo works.
   */
  import { onDestroy, onMount } from "svelte";
  import { Rect, ReplaceLayerPixelsCommand, type Raster, type RasterLayer } from "$lib/engine";
  import { docStore, type OpenDoc } from "$lib/stores/doc.svelte";
  import Modal from "$lib/filters/ui/Modal.svelte";
  import Slider from "$lib/filters/ui/Slider.svelte";
  import Histogram from "$lib/filters/ui/Histogram.svelte";
  import { affectedRect, applyOp, type ApplyResult } from "$lib/filters/apply";
  import { computeHistogram } from "$lib/filters/histogram";
  import { rawDoc, rawRasterLayer } from "$lib/filters/raw";
  import { recordLastFilter } from "$lib/filters/lastFilter";
  import { defaultParams, type Histogram as Hist, type OpDef, type ParamValue, type ParamValues } from "$lib/filters/types";

  interface Props {
    op: OpDef;
    onclose: () => void;
    /** Starting values (e.g. from Last Filter). */
    initial?: ParamValues;
  }

  let { op, onclose, initial }: Props = $props();

  // `op` / `initial` are fixed for the dialog's lifetime (a new op opens a new dialog).
  // svelte-ignore state_referenced_locally
  let params = $state<ParamValues>({ ...defaultParams(op), ...(initial ?? {}) });
  let preview = $state(true);
  // svelte-ignore state_referenced_locally
  let group = $state(op.groupSelector?.default ?? "");
  let hist = $state<Hist | null>(null);
  let previewHist = $state<Hist | null>(null);
  let backend = $state<"cpu" | "gpu" | null>(null);
  let lastMs = $state(0);
  let problem = $state<string | null>(null);

  // Non-reactive engine handles.
  let entry: OpenDoc | null = null;
  let layer: RasterLayer | null = null;
  let dirtyRect: Rect = Rect.empty();
  let original: Raster | null = null;
  let lastResult: ApplyResult | null = null;
  let resultParamsKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const visibleParams = $derived(op.params.filter((p) => !p.group || p.group === group));
  const dirtyPixels = $derived(dirtyRect.w * dirtyRect.h);

  onMount(() => {
    const e = docStore.active;
    const active = docStore.activeLayer;
    // Work on the raw engine objects, never through the store's proxies (see raw.ts).
    const l = e && active ? rawRasterLayer(e, active.id) : null;
    if (!e || !l) {
      problem = "Select a pixel layer to use this adjustment. Groups can't be adjusted directly.";
      return;
    }
    if (l.locked) {
      problem = "This layer is locked. Unlock it in the Layers panel first.";
      return;
    }
    entry = e;
    layer = l;
    dirtyRect = affectedRect(l.raster, rawDoc(e).selection, l.offset);
    if (Rect.isEmpty(dirtyRect)) {
      problem = "The selection doesn't overlap this layer, so there is nothing to adjust.";
      return;
    }
    original = l.raster.crop(dirtyRect);
    if (op.histogram) hist = computeHistogram(original);
    schedule();
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
    if (!closed) restoreOriginal();
  });

  function keyOf(p: ParamValues): string {
    return JSON.stringify(p);
  }

  function restoreOriginal(): void {
    if (!layer || !original) return;
    layer.raster.blit(original, dirtyRect.x, dirtyRect.y, undefined, { mode: "replace" });
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runPreview, 16);
  }

  function runPreview(): void {
    timer = null;
    if (!entry || !layer || !original) return;
    restoreOriginal();
    if (!preview) {
      docStore.touch({ layerId: layer.id, rect: dirtyRect });
      return;
    }
    const snapshot = $state.snapshot(params);
    const t0 = performance.now();
    const res = applyOp(op, layer.raster, snapshot, rawDoc(entry).selection, { offset: layer.offset });
    lastMs = performance.now() - t0;
    lastResult = res;
    resultParamsKey = keyOf(snapshot);
    backend = res.backend;
    layer.raster.blit(res.raster, res.dirtyRect.x, res.dirtyRect.y, undefined, { mode: "replace" });
    if (op.histogram) previewHist = computeHistogram(res.raster);
    docStore.touch({ layerId: layer.id, rect: res.dirtyRect });
  }

  function setParam(id: string, v: ParamValue): void {
    params[id] = v;
    schedule();
  }

  function reset(): void {
    params = defaultParams(op);
    if (op.groupSelector) group = op.groupSelector.default;
    schedule();
  }

  function auto(): void {
    if (!op.auto || !original) return;
    const h = hist ?? computeHistogram(original);
    Object.assign(params, op.auto(h));
    schedule();
  }

  function togglePreview(): void {
    preview = !preview;
    schedule();
  }

  function cancel(): void {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (layer) {
      restoreOriginal();
      docStore.touch({ layerId: layer.id, rect: dirtyRect });
    }
    onclose();
  }

  function ok(): void {
    if (closed) return;
    if (!entry || !layer || !original) {
      cancel();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = null;
    const snapshot = $state.snapshot(params);
    restoreOriginal();
    let res = lastResult;
    if (!res || resultParamsKey !== keyOf(snapshot)) {
      res = applyOp(op, layer.raster, snapshot, rawDoc(entry).selection, { offset: layer.offset });
    }
    closed = true;
    if (!Rect.isEmpty(res.dirtyRect)) {
      docStore.exec(new ReplaceLayerPixelsCommand(op.label, layer.id, res.dirtyRect, res.raster));
    } else {
      docStore.touch({ layerId: layer.id, rect: dirtyRect });
    }
    recordLastFilter(op, snapshot);
    onclose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      e.stopPropagation();
      if (problem) cancel();
      else ok();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<Modal title={op.label} onclose={cancel} width={op.histogram ? 380 : 360}>
  {#if problem}
    <p class="problem">{problem}</p>
  {:else}
    {#if op.histogram}
      <Histogram {hist} overlay={preview ? previewHist : null} />
    {/if}

    {#if op.groupSelector}
      <div class="segmented" role="tablist" aria-label={op.groupSelector.label}>
        {#each op.groupSelector.options as o (o.value)}
          <button
            type="button"
            role="tab"
            aria-selected={group === o.value}
            class:on={group === o.value}
            onclick={() => (group = o.value)}>{o.label}</button
          >
        {/each}
      </div>
    {/if}

    <div class="params">
      {#each visibleParams as p (p.id)}
        {#if p.kind === "number"}
          <Slider
            label={p.label}
            value={typeof params[p.id] === "number" ? (params[p.id] as number) : p.default}
            min={p.min}
            max={p.max}
            step={p.step}
            unit={p.unit ?? ""}
            onchange={(v) => setParam(p.id, v)}
          />
        {:else if p.kind === "boolean"}
          <label class="check">
            <input type="checkbox" checked={params[p.id] === true} onchange={(e) => setParam(p.id, e.currentTarget.checked)} />
            <span>{p.label}</span>
          </label>
        {:else if p.kind === "select"}
          <label class="row">
            <span class="name">{p.label}</span>
            <select value={String(params[p.id] ?? p.default)} onchange={(e) => setParam(p.id, e.currentTarget.value)}>
              {#each p.options as o (o.value)}
                <option value={o.value}>{o.label}</option>
              {/each}
            </select>
          </label>
        {:else}
          <div class="row">
            <span class="name">{p.label}</span>
            <span class="muted mono">curve editor arrives in 1.1</span>
          </div>
        {/if}
      {/each}
      {#if visibleParams.length === 0}
        <p class="muted">This adjustment has no settings. Press OK to apply it.</p>
      {/if}
    </div>

    <div class="status">
      <label class="check">
        <input type="checkbox" checked={preview} onchange={togglePreview} />
        <span>Preview</span>
      </label>
      <span class="grow"></span>
      {#if backend}
        <span class="chip" class:gpu={backend === "gpu"} title="{dirtyPixels.toLocaleString()} px in {lastMs.toFixed(1)} ms">
          {backend === "gpu" ? "GPU" : "CPU"} · {lastMs < 1 ? "<1" : Math.round(lastMs)} ms
        </span>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if problem}
      <span class="grow"></span>
      <button class="btn primary" type="button" onclick={cancel}>Close</button>
    {:else}
      {#if op.auto}
        <button class="btn" type="button" onclick={auto}>Auto</button>
      {/if}
      <button class="btn" type="button" onclick={reset}>Reset</button>
      <span class="grow"></span>
      <button class="btn" type="button" onclick={cancel}>Cancel</button>
      <button class="btn primary" type="button" onclick={ok}>OK</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .params {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 10px;
  }
  .name {
    color: var(--fg-1);
  }
  select {
    font: inherit;
    color: var(--fg-0);
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 6px;
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
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    align-self: flex-start;
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
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  .grow {
    flex: 1;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--fg-2);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-1);
  }
  .chip.gpu {
    color: var(--accent-2);
    background: rgba(34, 211, 238, 0.1);
  }
  .problem {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: rgba(255, 92, 122, 0.1);
    border: 1px solid rgba(255, 92, 122, 0.3);
    color: var(--fg-0);
    line-height: 1.45;
  }
  .muted {
    color: var(--fg-2);
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
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
  .btn.primary:hover {
    filter: brightness(1.1);
  }
</style>
