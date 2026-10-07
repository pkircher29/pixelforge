<script lang="ts">
  /**
   * Info panel (PS): two eyedropper readouts (click the dropper to change the mode),
   * cursor X/Y in the ruler unit, selection W/H (transform W/H/A while transforming),
   * colour samplers #1–#4, ruler-tool readout, document size line and the status tip.
   */
  import { Rect, compositeToRaster, documentByteSize, type Raster, type RGBA } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { transformSession } from "$lib/filters/transform/session.svelte";
  import { toolLabel } from "$lib/tools";
  import { canvasHost } from "../canvas/host.svelte";
  import Icon from "../icons/Icon.svelte";
  import Popover from "../controls/Popover.svelte";
  import { infoUi } from "./Info.store.svelte";
  import { INFO_COLOR_MODES, colorReadout, cursorReadout, docSizeLine, measureReadout, sizeReadout, type InfoColorMode, type ReadoutLine } from "./info-model";

  const entry = $derived(docStore.active);
  const unit = $derived(settings.value.rulerUnit);
  const dims = $derived.by(() => {
    if (!entry) return { w: 0, h: 0, dpi: 72 };
    void entry.version;
    return { w: entry.doc.width, h: entry.doc.height, dpi: entry.doc.meta.dpi || 72 };
  });

  // Colour under the cursor: composite one pixel into a cached document-sized scratch.
  let scratch: Raster | null = null;
  const under = $derived.by((): RGBA | null => {
    const e = entry;
    const cur = ui.cursorDoc;
    if (!e || !cur) return null;
    void e.version;
    const doc = e.doc;
    if (cur.x < 0 || cur.y < 0 || cur.x >= doc.width || cur.y >= doc.height) return null;
    if (!scratch || scratch.width !== doc.width || scratch.height !== doc.height) scratch = null;
    scratch = compositeToRaster(doc, scratch ? { into: scratch, rect: Rect.make(cur.x, cur.y, 1, 1) } : { rect: Rect.make(cur.x, cur.y, 1, 1) });
    return scratch.getPixel(cur.x, cur.y);
  });

  const first = $derived(colorReadout(infoUi.first, under));
  const second = $derived(colorReadout(infoUi.second, under));
  const xy = $derived(cursorReadout(ui.cursorDoc, unit, dims.dpi, dims.w, dims.h));
  const size = $derived.by(() => {
    if (transformSession.active) {
      const b = transformSession.bounds;
      const p = transformSession.params;
      return sizeReadout({ kind: "transform", w: Math.abs(b.w * p.sx), h: Math.abs(b.h * p.sy), angle: (p.angle * 180) / Math.PI }, unit, dims.dpi, dims.w, dims.h);
    }
    const e = entry;
    if (!e) return sizeReadout(null, unit, dims.dpi, dims.w, dims.h);
    void e.version;
    const bb = e.doc.selection.isEmpty ? null : e.doc.selection.bbox;
    return sizeReadout(bb ? { kind: "selection", w: bb.w, h: bb.h } : null, unit, dims.dpi, dims.w, dims.h);
  });
  const samplers = $derived(toolStore.colorSamplers.map((s) => ({ id: s.id, lines: colorReadout(infoUi.first, s.color) })));
  const measure = $derived(measureReadout(toolStore.measure, unit, dims.dpi, dims.w, dims.h));
  const docLine = $derived.by(() => {
    const e = entry;
    if (!e) return "";
    void e.pixelVersion;
    return docSizeLine(e.doc.width * e.doc.height * 4, documentByteSize(e.doc));
  });
  const tip = $derived(toolStore.hint || `${toolLabel(canvasHost.selectedTool)} tool.`);

  let menuFor = $state<"first" | "second" | null>(null);
  let anchor = $state<HTMLElement | null>(null);
  function openMenu(which: "first" | "second", e: MouseEvent): void {
    anchor = e.currentTarget as HTMLElement;
    menuFor = menuFor === which ? null : which;
  }
  function setMode(m: InfoColorMode): void {
    if (menuFor === "first") infoUi.first = m;
    else if (menuFor === "second") infoUi.second = m;
    infoUi.persist();
    menuFor = null;
  }
  function pad(lines: ReadoutLine[], n: number): ReadoutLine[] {
    const out = lines.slice();
    while (out.length < n) out.push({ k: "", v: "" });
    return out;
  }
</script>

<div class="info">
  <div class="cols">
    <div class="block">
      <button type="button" class="glyph drop" aria-label="First readout mode" onclick={(e) => openMenu("first", e)}><Icon name="eyedropper" size={14} /><span class="tri"></span></button>
      <div class="lines">{#each pad(first, 4) as l, i (i)}<div class="ln"><span class="k">{l.k}{l.k ? " :" : ""}</span><span class="v">{l.v}</span></div>{/each}</div>
    </div>
    <div class="block">
      <button type="button" class="glyph drop" aria-label="Second readout mode" onclick={(e) => openMenu("second", e)}><Icon name="eyedropper" size={14} /><span class="tri"></span></button>
      <div class="lines">{#each pad(second, 4) as l, i (i)}<div class="ln"><span class="k">{l.k}{l.k ? " :" : ""}</span><span class="v">{l.v}</span></div>{/each}</div>
    </div>
  </div>
  <div class="cols bits">
    <span>8-bit</span><span>8-bit</span>
  </div>
  <div class="cols">
    <div class="block">
      <span class="glyph plus">+</span>
      <div class="lines">{#each xy as l (l.k)}<div class="ln"><span class="k">{l.k} :</span><span class="v">{l.v}</span></div>{/each}</div>
    </div>
    <div class="block">
      <span class="glyph"><Icon name="marquee-rect" size={13} /></span>
      <div class="lines">{#each size as l (l.k)}<div class="ln"><span class="k">{l.k} :</span><span class="v">{l.v}</span></div>{/each}</div>
    </div>
  </div>
  {#if samplers.length}
    <div class="cols samplers">
      {#each samplers as s (s.id)}
        <div class="block">
          <span class="glyph hash">#{s.id}</span>
          <div class="lines">{#each s.lines as l (l.k)}<div class="ln"><span class="k">{l.k} :</span><span class="v">{l.v}</span></div>{/each}</div>
        </div>
      {/each}
    </div>
  {/if}
  {#if measure.length}
    <div class="cols">
      <div class="block">
        <span class="glyph"><Icon name="ruler" size={13} /></span>
        <div class="lines">{#each measure.slice(0, 2) as l (l.k)}<div class="ln"><span class="k">{l.k} :</span><span class="v">{l.v}</span></div>{/each}</div>
      </div>
      <div class="block">
        <span class="glyph"></span>
        <div class="lines">{#each measure.slice(2) as l (l.k)}<div class="ln"><span class="k">{l.k} :</span><span class="v">{l.v}</span></div>{/each}</div>
      </div>
    </div>
  {/if}
  {#if infoUi.showDocSize && docLine}
    <div class="docline">{docLine}</div>
  {/if}
  {#if infoUi.showTips}
    <div class="tip">{tip}</div>
  {/if}

  <Popover {anchor} open={menuFor !== null} onclose={() => (menuFor = null)} minWidth={140}>
    <div class="pmenu" role="menu">
      {#each INFO_COLOR_MODES as m (m.id)}
        {@const on = (menuFor === "first" ? infoUi.first : infoUi.second) === m.id}
        <button type="button" role="menuitemradio" aria-checked={on} class="pitem" onclick={() => setMode(m.id)}>
          <span class="pchk">{#if on}<Icon name="check" size={12} />{/if}</span>{m.label}
        </button>
      {/each}
    </div>
  </Popover>
</div>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    color: var(--ps-text);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 8px;
  }
  .cols.samplers {
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: 0 -1px 0 var(--ps-border-light);
    padding-top: 4px;
    margin-top: 2px;
  }
  .bits {
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
    padding: 0 0 4px 22px;
  }
  .block {
    display: flex;
    gap: 4px;
    align-items: flex-start;
    min-width: 0;
  }
  .glyph {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 16px;
    flex: none;
    color: var(--ps-text-dim);
    font-size: var(--fs-xs);
  }
  .glyph.drop:hover {
    color: var(--ps-text);
    background: var(--ps-hover);
    border-radius: 2px;
  }
  .glyph.plus {
    font-size: 14px;
    line-height: 1;
  }
  .glyph.hash {
    font-weight: 600;
  }
  .tri {
    position: absolute;
    right: -2px;
    bottom: 0;
    border: 2.5px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
  }
  .lines {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .ln {
    display: flex;
    gap: 6px;
    height: 15px;
    line-height: 15px;
  }
  .k {
    width: 24px;
    flex: none;
    color: var(--ps-text-dim);
    text-align: right;
    white-space: pre;
  }
  .v {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .docline {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: 0 -1px 0 var(--ps-border-light);
    color: var(--ps-text);
  }
  .tip {
    color: var(--ps-text-dim);
    line-height: 1.35;
    padding-top: 2px;
  }
  .pmenu {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .pitem {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 12px 0 4px;
    text-align: left;
    white-space: nowrap;
    color: var(--ps-text);
  }
  .pitem:hover {
    background: var(--ps-row-selected);
  }
  .pchk {
    display: grid;
    width: 16px;
    place-items: center;
  }
</style>
