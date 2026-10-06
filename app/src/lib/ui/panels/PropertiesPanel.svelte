<script lang="ts">
  import { SetLayerPropsCommand, BLEND_MODE_LABEL } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";

  const entry = $derived(docStore.active);
  // Engine objects are raw (not reactive): snapshot what we show on every `version` tick.
  const layer = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    const l = docStore.activeLayer;
    if (!l) return null;
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      w: l.kind === "raster" ? l.raster.width : 0,
      h: l.kind === "raster" ? l.raster.height : 0,
      x: l.offset.x,
      y: l.offset.y,
      blend: BLEND_MODE_LABEL[l.blendMode],
      opacity: Math.round(l.opacity * 100),
      visible: l.visible,
      locked: l.locked,
    };
  });
  const info = $derived.by(() => {
    if (!entry) return null;
    void entry.version;
    const d = entry.doc;
    const bb = d.selection.bbox;
    return {
      w: d.width,
      h: d.height,
      dpi: d.meta.dpi,
      layers: d.layers.length,
      path: entry.path,
      sel: bb ? `${bb.w} × ${bb.h} at ${bb.x}, ${bb.y}` : "none",
      source: typeof d.meta.sourceFormat === "string" ? d.meta.sourceFormat.toUpperCase() : null,
    };
  });

  function setOffset(axis: "x" | "y", v: number) {
    if (!layer || !Number.isFinite(v)) return;
    const next = { x: layer.x, y: layer.y, [axis]: Math.round(v) };
    docStore.exec(new SetLayerPropsCommand(layer.id, { offset: next }), { noMerge: true });
  }
  function rename(v: string) {
    if (!layer) return;
    const name = v.trim();
    if (name && name !== layer.name) docStore.exec(new SetLayerPropsCommand(layer.id, { name }));
  }
</script>

<div class="props">
  {#if entry && info}
    {#if layer}
      <section>
        <h3>{layer.kind === "group" ? "Group" : "Layer"}</h3>
        <label class="row"><span>Name</span><input class="input" type="text" value={layer.name} onchange={(e) => rename(e.currentTarget.value)} /></label>
        {#if layer.kind === "raster"}
          <div class="row"><span>Size</span><span class="mono">{layer.w} × {layer.h} px</span></div>
          <div class="row">
            <span>Position</span>
            <span class="pair">
              <input class="input num" type="number" value={layer.x} onchange={(e) => setOffset("x", Number(e.currentTarget.value))} aria-label="X" />
              <input class="input num" type="number" value={layer.y} onchange={(e) => setOffset("y", Number(e.currentTarget.value))} aria-label="Y" />
            </span>
          </div>
        {/if}
        <div class="row"><span>Blend</span><span>{layer.blend} · {layer.opacity}%</span></div>
        <div class="row"><span>State</span><span>{layer.visible ? "visible" : "hidden"}{layer.locked ? ", locked" : ""}</span></div>
      </section>
    {/if}
    <section>
      <h3>Document</h3>
      <div class="row"><span>Canvas</span><span class="mono">{info.w} × {info.h} px · {info.dpi} dpi</span></div>
      <div class="row"><span>Layers</span><span class="mono">{info.layers}</span></div>
      <div class="row"><span>Selection</span><span class="mono">{info.sel}</span></div>
      {#if info.source}<div class="row"><span>Source</span><span>{info.source}</span></div>{/if}
      <div class="row"><span>File</span><span class="path" title={info.path ?? ""}>{info.path ?? "not saved yet"}</span></div>
    </section>
  {:else}
    <div class="empty">Nothing selected.</div>
  {/if}
</div>

<style>
  .props {
    padding: 4px 0;
    font-size: var(--fs-sm);
  }
  section {
    padding: 6px 10px 10px;
  }
  section + section {
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--fg-2);
  }
  .row {
    display: grid;
    grid-template-columns: 70px 1fr;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    color: var(--fg-1);
  }
  .row > span:first-child {
    color: var(--fg-2);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .pair {
    display: flex;
    gap: 6px;
  }
  .num {
    width: 70px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }
  .empty {
    padding: 14px 10px;
    color: var(--fg-2);
  }
</style>
