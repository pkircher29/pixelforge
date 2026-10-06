<script lang="ts">
  /**
   * Properties panel — context-sensitive like Photoshop: pixel layer (Transform with
   * W/H/X/Y, flip / rotate, align), adjustment layer (the op's parameters as live
   * sliders + the PS footer: clip, view previous state, reset, visibility, delete),
   * fill layer, mask (Density / Feather, applied with Apply), type layer, shape layer,
   * and the document when nothing is selected.
   */
  import {
    Rect,
    SetAdjustmentParamsCommand,
    SetFillLayerCommand,
    SetLayerMaskCommand,
    SetLayerPropsCommand,
    SetMaskEnabledCommand,
    SetSelectionCommand,
    SetShapeLayerCommand,
    SetTextLayerCommand,
    SetClipToBelowCommand,
    ApplyMaskCommand,
    TransformLayerCommand,
    flipLayerCommand,
    rotateLayer90Command,
    loadMaskAsSelection,
    opById,
    type FillSpec,
  } from "$lib/engine";
  import type { ParamValue } from "$lib/engine/ops/types";
  import { docStore } from "$lib/stores/doc.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { runCommand } from "../registry.svelte";
  import { openDialog } from "../dialogs/dialogs.svelte";
  import FillLayerDialog from "../dialogs/FillLayerDialog.svelte";
  import Icon from "../icons/Icon.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import Segmented from "../controls/Segmented.svelte";
  import { layersUi } from "./Layers.store.svelte";
  import { propertiesContext, CONTEXT_TITLE, visibleAdjustmentParams, adjustmentDefaults, paramNumber, adjustmentModified, processMask, invertMask, resizedRaster } from "./Properties.model";
  import { rgbaToHex, hexToRgba } from "../dialogs/layer-style-model";
  import { TEXT_FAMILIES } from "$lib/tools/paint/text";

  const entry = $derived(docStore.active);
  const doc = $derived(entry?.doc ?? null);

  /** Everything the template shows, snapshotted per version (engine objects are raw). */
  const view = $derived.by(() => {
    if (!entry || !doc) return null;
    void entry.version;
    const l = docStore.activeLayer;
    const ctx = propertiesContext(doc, l, layersUi.maskTargeted);
    return { ctx, layer: l, title: ctx === "adjustment" && l?.kind === "adjustment" ? (opById(l.op)?.label ?? l.name) : CONTEXT_TITLE[ctx], tick: entry.version };
  });

  // ---------------------------------------------------------------- pixel / transform
  function pixel() {
    const l = view?.layer;
    return l && (l.kind === "raster" || l.kind === "shape" || l.kind === "text") ? l : null;
  }
  function setOffset(axis: "x" | "y", v: number) {
    const l = view?.layer;
    if (!l) return;
    docStore.exec(new SetLayerPropsCommand(l.id, { offset: { ...l.offset, [axis]: Math.round(v) } }));
  }
  function setSize(axis: "w" | "h", v: number) {
    const l = pixel();
    if (!l) return;
    const r = resizedRaster(l.raster, axis === "w" ? v : l.raster.width, axis === "h" ? v : l.raster.height);
    if (r) docStore.exec(new TransformLayerCommand(l.id, r, l.offset, "Scale"));
  }
  function align(kind: string) {
    void runCommand(`layer.align.${kind}`);
  }

  // ---------------------------------------------------------------- adjustment
  function adj() {
    const l = view?.layer;
    return l && l.kind === "adjustment" ? l : null;
  }
  function setParam(id: string, v: ParamValue, merge = true) {
    const l = adj();
    if (!l) return;
    docStore.exec(new SetAdjustmentParamsCommand(l.id, { [id]: v }, { label: opById(l.op)?.label ?? "Adjustment" }), { noMerge: !merge });
  }
  function resetAdjustment() {
    const l = adj();
    if (l) docStore.exec(new SetAdjustmentParamsCommand(l.id, adjustmentDefaults(l), { label: "Reset Adjustment" }), { noMerge: true });
  }
  let peeking = $state(false);
  function peekStart(e: PointerEvent) {
    const l = view?.layer;
    if (!l || !l.visible) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    peeking = true;
    l.visible = false;
    docStore.touch();
  }
  function peekEnd() {
    const l = view?.layer;
    if (!peeking || !l) return;
    peeking = false;
    l.visible = true;
    docStore.touch();
  }

  // ---------------------------------------------------------------- mask
  let density = $state(100);
  let feather = $state(0);
  $effect(() => {
    void view?.layer?.id;
    density = 100;
    feather = 0;
  });
  function applyMaskEdits() {
    const l = view?.layer;
    if (!l?.mask) return;
    if (density === 100 && feather === 0) return;
    docStore.exec(new SetLayerMaskCommand(l.id, processMask(l.mask, density / 100, feather), "Mask Density / Feather"));
    density = 100;
    feather = 0;
  }
  function invert() {
    const l = view?.layer;
    if (l?.mask) docStore.exec(new SetLayerMaskCommand(l.id, invertMask(l.mask), "Invert Mask"));
  }

  // ---------------------------------------------------------------- fill
  async function editFill() {
    const l = view?.layer;
    if (!l || l.kind !== "fill") return;
    const r = await openDialog<{ fill: FillSpec; layerId: string }, FillSpec>(FillLayerDialog, { fill: l.fill, layerId: l.id });
    if (r) docStore.exec(new SetFillLayerCommand(l.id, r), { noMerge: true });
  }
  function setSolid(hex: string) {
    const l = view?.layer;
    const c = hexToRgba(hex);
    if (!l || l.kind !== "fill" || !c) return;
    docStore.exec(new SetFillLayerCommand(l.id, { type: "solid", color: c }));
  }

  // ---------------------------------------------------------------- text
  function text() {
    const l = view?.layer;
    return l && l.kind === "text" ? l : null;
  }
  function setText(patch: Record<string, unknown>, merge = false) {
    const l = text();
    if (l) docStore.exec(new SetTextLayerCommand(l.id, patch), { noMerge: !merge });
  }
  const FAMILIES = TEXT_FAMILIES.map((f) => ({ value: f, label: f }));
  const ALIGN = [
    { value: "left", icon: "align-left", title: "Left align text" },
    { value: "center", icon: "align-hcenter", title: "Center text" },
    { value: "right", icon: "align-right", title: "Right align text" },
  ];

  // ---------------------------------------------------------------- shape
  function shape() {
    const l = view?.layer;
    return l && l.kind === "shape" ? l : null;
  }
  const STROKE_POS = [
    { value: "inside", label: "Inside" },
    { value: "center", label: "Center" },
    { value: "outside", label: "Outside" },
  ];
  function setShapeFill(hex: string | null) {
    const l = shape();
    if (!l) return;
    const c = hex ? hexToRgba(hex) : null;
    docStore.exec(new SetShapeLayerCommand(l.id, { fill: c ? { type: "solid", color: c } : null }, "Shape Fill"), { noMerge: true });
  }
  function setStroke(patch: { width?: number; color?: string; position?: "inside" | "outside" | "center"; enabled?: boolean }) {
    const l = shape();
    if (!l) return;
    const cur = l.stroke ?? { width: 1, fill: { type: "solid" as const, color: { ...toolStore.fg } }, position: "center" as const, cap: "butt" as const, join: "miter" as const, dash: null };
    if (patch.enabled === false) {
      docStore.exec(new SetShapeLayerCommand(l.id, { stroke: null }, "Shape Stroke"), { noMerge: true });
      return;
    }
    const c = patch.color ? hexToRgba(patch.color) : null;
    const next = { ...cur, width: patch.width ?? cur.width, position: patch.position ?? cur.position, fill: c ? { type: "solid" as const, color: c } : cur.fill };
    docStore.exec(new SetShapeLayerCommand(l.id, { stroke: next }, "Shape Stroke"), { noMerge: true });
  }

  function del() {
    void runCommand("layer.delete");
  }
</script>

<div class="props">
  {#if view && doc}
    <header class="head">
      <span class="hicon">
        <Icon name={view.ctx === "adjustment" ? "adjustment" : view.ctx === "mask" ? "mask" : view.ctx === "text" ? "kind-type" : view.ctx === "shape" ? "kind-shape" : view.ctx === "group" ? "folder" : view.ctx === "document" ? "document" : "kind-pixel"} size={14} />
      </span>
      <span class="htitle">{view.title}</span>
    </header>

    {#if view.ctx === "document"}
      <section>
        <div class="row"><span class="lbl">Canvas</span><span class="val mono">{doc.width} × {doc.height} px</span></div>
        <div class="row"><span class="lbl">Resolution</span><span class="val mono">{doc.meta.dpi} ppi</span></div>
        <div class="row"><span class="lbl">Mode</span><span class="val">RGB Color, 8 bits/channel</span></div>
        <div class="row"><span class="lbl">Layers</span><span class="val mono">{doc.layers.length}</span></div>
      </section>
      <section class="btns">
        <button type="button" class="btn" onclick={() => void runCommand("image.size")}>Image Size…</button>
        <button type="button" class="btn" onclick={() => void runCommand("image.canvasSize")}>Canvas Size…</button>
      </section>

    {:else if view.ctx === "pixel" || view.ctx === "group"}
      {@const l = view.layer!}
      {@const p = pixel()}
      <section>
        <h4>Transform</h4>
        <div class="grid2">
          <ScrubbyNumber label="W" unit="px" min={1} max={8192} value={p ? p.raster.width : doc.width} disabled={!p} width={52} slider={false} onchange={(v) => setSize("w", v)} />
          <ScrubbyNumber label="X" unit="px" min={-8192} max={8192} value={l.offset.x} disabled={!p} width={52} slider={false} onchange={(v) => setOffset("x", v)} />
          <ScrubbyNumber label="H" unit="px" min={1} max={8192} value={p ? p.raster.height : doc.height} disabled={!p} width={52} slider={false} onchange={(v) => setSize("h", v)} />
          <ScrubbyNumber label="Y" unit="px" min={-8192} max={8192} value={l.offset.y} disabled={!p} width={52} slider={false} onchange={(v) => setOffset("y", v)} />
        </div>
        <div class="tools">
          <button type="button" class="icon-btn" data-tip="Flip horizontal" aria-label="Flip horizontal" disabled={!p} onclick={() => p && docStore.exec(flipLayerCommand(doc, p.id, "h"))}><Icon name="swap-colors" size={14} /></button>
          <button type="button" class="icon-btn" data-tip="Flip vertical" aria-label="Flip vertical" disabled={!p} onclick={() => p && docStore.exec(flipLayerCommand(doc, p.id, "v"))}><Icon name="swap-colors" class="rot" size={14} /></button>
          <button type="button" class="icon-btn" data-tip="Rotate 90° clockwise" aria-label="Rotate 90° clockwise" disabled={!p} onclick={() => p && docStore.exec(rotateLayer90Command(doc, p.id, true))}><Icon name="redo" size={14} /></button>
          <button type="button" class="icon-btn" data-tip="Rotate 90° counter-clockwise" aria-label="Rotate 90° counter-clockwise" disabled={!p} onclick={() => p && docStore.exec(rotateLayer90Command(doc, p.id, false))}><Icon name="undo" size={14} /></button>
        </div>
      </section>
      <section>
        <h4>Align and Distribute</h4>
        <div class="tools">
          {#each ["left", "hcenter", "right", "top", "vcenter", "bottom"] as k (k)}
            <button type="button" class="icon-btn" data-tip="Align {k}" aria-label="Align {k}" disabled={!p} onclick={() => align(k)}><Icon name="align-{k}" size={14} /></button>
          {/each}
          <span class="sep"></span>
          <button type="button" class="icon-btn" data-tip="Distribute horizontal centers" aria-label="Distribute horizontally" onclick={() => void runCommand("layer.distribute.h")}><Icon name="distribute-h" size={14} /></button>
          <button type="button" class="icon-btn" data-tip="Distribute vertical centers" aria-label="Distribute vertically" onclick={() => void runCommand("layer.distribute.v")}><Icon name="distribute-v" size={14} /></button>
        </div>
        <p class="hint">Aligns to the selection, or to the canvas when nothing is selected.</p>
      </section>

    {:else if view.ctx === "adjustment"}
      {@const l = adj()!}
      {@const vp = visibleAdjustmentParams(l)}
      <section class="adj">
        {#if vp.selector}
          <div class="row"><span class="lbl">{vp.selector.label}</span><PsSelect value={vp.group ?? vp.selector.default} choices={vp.selector.options} width={120} onchange={(v) => setParam(vp.selector!.id, v, false)} /></div>
        {/if}
        {#each vp.defs as d (d.id)}
          {#if d.kind === "number"}
            <div class="prow">
              <span class="plbl">{d.label}</span>
              <span class="pval mono">{Math.round(paramNumber(l.params, d) * 100) / 100}{d.unit ?? ""}</span>
              <input class="prange" type="range" min={d.min} max={d.max} step={d.step} value={paramNumber(l.params, d)} oninput={(e) => setParam(d.id, Number(e.currentTarget.value))} onchange={(e) => setParam(d.id, Number(e.currentTarget.value))} aria-label={d.label} />
            </div>
          {:else if d.kind === "boolean"}
            <label class="chk"><input type="checkbox" checked={l.params[d.id] === true} onchange={(e) => setParam(d.id, e.currentTarget.checked, false)} /> {d.label}</label>
          {:else if d.kind === "select"}
            <div class="row"><span class="lbl">{d.label}</span><PsSelect value={String(l.params[d.id] ?? d.default)} choices={d.options} width={120} onchange={(v) => setParam(d.id, v, false)} /></div>
          {/if}
        {/each}
        {#if vp.defs.length === 0 && !vp.selector}
          <p class="hint">This adjustment has no settings.</p>
        {/if}
      </section>
      <footer class="foot">
        <button type="button" class="icon-btn" class:on={l.clipToBelow} data-tip="This adjustment affects all layers below (click to clip to layer)" aria-label="Clip to layer" onclick={() => docStore.exec(new SetClipToBelowCommand(l.id, !l.clipToBelow))}><Icon name="clip-arrow" size={14} /></button>
        <button type="button" class="icon-btn" data-tip="View previous state (press and hold)" aria-label="View previous state" onpointerdown={peekStart} onpointerup={peekEnd} onpointercancel={peekEnd}><Icon name="history-source" size={14} /></button>
        <button type="button" class="icon-btn" data-tip="Reset to adjustment defaults" aria-label="Reset to defaults" disabled={!adjustmentModified(l)} onclick={resetAdjustment}><Icon name="undo" size={14} /></button>
        <button type="button" class="icon-btn" data-tip="Toggle layer visibility" aria-label="Toggle layer visibility" onclick={() => docStore.exec(new SetLayerPropsCommand(l.id, { visible: !l.visible }))}><Icon name={l.visible ? "eye" : "eye-off"} size={14} /></button>
        <button type="button" class="icon-btn" data-tip="Delete this adjustment layer" aria-label="Delete this adjustment layer" onclick={del}><Icon name="trash" size={14} /></button>
      </footer>

    {:else if view.ctx === "fill"}
      {@const l = view.layer!}
      {#if l.kind === "fill"}
        <section>
          {#if l.fill.type === "solid"}
            <div class="row"><span class="lbl">Color</span><span class="val"><input type="color" class="swatch" value={rgbaToHex(l.fill.color)} oninput={(e) => setSolid(e.currentTarget.value)} aria-label="Fill color" /></span></div>
          {:else if l.fill.type === "gradient"}
            {@const first = l.fill.gradient.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }}
            {@const last = l.fill.gradient.stops[l.fill.gradient.stops.length - 1]?.color ?? { r: 255, g: 255, b: 255, a: 255 }}
            <div class="row"><span class="lbl">Gradient</span><span class="gbar" style:background="linear-gradient(90deg, {rgbaToHex(first)}, {rgbaToHex(last)})"></span></div>
            <div class="row"><span class="lbl">Style</span><span class="val">{l.fill.style}, {l.fill.angle}°, {Math.round(l.fill.scale * 100)} %</span></div>
          {:else}
            <div class="row"><span class="lbl">Pattern</span><span class="val mono">{l.fill.pattern.width} × {l.fill.pattern.height} px tile · {Math.round(l.fill.scale * 100)} %</span></div>
          {/if}
          <div class="btns"><button type="button" class="btn" onclick={editFill}>Edit Fill…</button></div>
        </section>
      {/if}

    {:else if view.ctx === "mask"}
      {@const l = view.layer!}
      <section>
        <div class="row"><span class="lbl">Layer Mask</span><span class="val">{l.name}</span></div>
        <div class="prow">
          <span class="plbl">Density</span>
          <span class="pval mono">{density}%</span>
          <input class="prange" type="range" min="0" max="100" bind:value={density} aria-label="Density" />
        </div>
        <div class="prow">
          <span class="plbl">Feather</span>
          <span class="pval mono">{feather} px</span>
          <input class="prange" type="range" min="0" max="100" step="0.5" bind:value={feather} aria-label="Feather" />
        </div>
        <div class="btns">
          <button type="button" class="btn" disabled={density === 100 && feather === 0} onclick={applyMaskEdits}>Apply</button>
          <button type="button" class="btn" disabled>Select and Mask…</button>
          <button type="button" class="btn" disabled>Color Range…</button>
          <button type="button" class="btn" onclick={invert}>Invert</button>
        </div>
        <p class="hint">Density and Feather are applied to the mask pixels when you click Apply.</p>
      </section>
      <footer class="foot">
        <button type="button" class="icon-btn" data-tip="Load selection from mask" aria-label="Load selection from mask" onclick={() => { const s = loadMaskAsSelection(doc, l.id); if (s) docStore.exec(new SetSelectionCommand(s, "Load Selection")); }}><Icon name="marquee-rect" size={14} /></button>
        <button type="button" class="icon-btn" data-tip="Apply mask" aria-label="Apply mask" disabled={!(l.kind === "raster" || l.kind === "shape" || l.kind === "text")} onclick={() => { docStore.exec(new ApplyMaskCommand(l.id)); layersUi.maskTargeted = false; }}><Icon name="mask-filled" size={14} /></button>
        <button type="button" class="icon-btn" class:on={!l.maskEnabled} data-tip={l.maskEnabled ? "Disable mask" : "Enable mask"} aria-label="Enable or disable mask" onclick={() => docStore.exec(new SetMaskEnabledCommand(l.id, !l.maskEnabled))}><Icon name={l.maskEnabled ? "eye" : "eye-off"} size={14} /></button>
        <button type="button" class="icon-btn" data-tip="Delete mask" aria-label="Delete mask" onclick={() => { docStore.exec(new SetLayerMaskCommand(l.id, null)); layersUi.maskTargeted = false; }}><Icon name="trash" size={14} /></button>
      </footer>

    {:else if view.ctx === "text"}
      {@const l = text()!}
      <section>
        <h4>Character</h4>
        <div class="row"><span class="lbl">Font</span><PsSelect value={l.text.font} choices={FAMILIES} width={140} onchange={(v) => setText({ font: v })} /></div>
        <div class="row"><span class="lbl">Size</span><ScrubbyNumber unit="px" min={4} max={800} value={l.text.size} width={48} log oninput={(v) => setText({ size: v }, true)} onchange={(v) => setText({ size: v }, true)} /></div>
        <div class="row"><span class="lbl">Leading</span><ScrubbyNumber unit="px" min={0} max={2000} value={l.text.leading ?? Math.round(l.text.size * 1.2)} width={48} oninput={(v) => setText({ leading: v }, true)} onchange={(v) => setText({ leading: v }, true)} /></div>
        <div class="row"><span class="lbl">Tracking</span><ScrubbyNumber min={-1000} max={1000} value={l.text.tracking} width={48} oninput={(v) => setText({ tracking: v }, true)} onchange={(v) => setText({ tracking: v }, true)} /></div>
        <div class="row"><span class="lbl">Color</span><span class="val"><input type="color" class="swatch" value={rgbaToHex(l.text.color)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) setText({ color: c }, true); }} aria-label="Text color" /></span></div>
        <div class="row"><span class="lbl">Style</span><span class="val tools"><button type="button" class="tb" class:on={l.text.bold} onclick={() => setText({ bold: !l.text.bold })}><b>B</b></button><button type="button" class="tb" class:on={l.text.italic} onclick={() => setText({ italic: !l.text.italic })}><i>I</i></button><label class="chk"><input type="checkbox" checked={l.text.antialias} onchange={(e) => setText({ antialias: e.currentTarget.checked })} /> Anti-alias</label></span></div>
      </section>
      <section>
        <h4>Paragraph</h4>
        <div class="row"><span class="lbl">Align</span><Segmented value={l.text.align} items={ALIGN} onchange={(v) => setText({ align: v })} /></div>
        <div class="row"><span class="lbl">Orientation</span><span class="val"><label class="chk"><input type="checkbox" checked={l.text.vertical} onchange={(e) => setText({ vertical: e.currentTarget.checked })} /> Vertical</label></span></div>
      </section>
      <section class="btns">
        <button type="button" class="btn" onclick={() => void runCommand("layer.rasterize.type")}>Rasterize Type</button>
      </section>

    {:else if view.ctx === "shape"}
      {@const l = shape()!}
      {@const b = Rect.intersect(Rect.ofSize(doc.width, doc.height), l.raster.boundingBoxOfAlpha(0) ?? Rect.ofSize(doc.width, doc.height))}
      <section>
        <h4>Transform</h4>
        <div class="row"><span class="lbl">Bounds</span><span class="val mono">{b.w} × {b.h} at {b.x}, {b.y}</span></div>
      </section>
      <section>
        <h4>Appearance</h4>
        <div class="row"><span class="lbl">Fill</span><span class="val tools"><input type="color" class="swatch" value={l.fill && l.fill.type === "solid" ? rgbaToHex(l.fill.color) : "#000000"} disabled={!l.fill} oninput={(e) => setShapeFill(e.currentTarget.value)} aria-label="Fill color" /><label class="chk"><input type="checkbox" checked={!!l.fill} onchange={(e) => setShapeFill(e.currentTarget.checked ? rgbaToHex(toolStore.fg) : null)} /> On</label></span></div>
        <div class="row"><span class="lbl">Stroke</span><span class="val tools"><input type="color" class="swatch" value={l.stroke && l.stroke.fill.type === "solid" ? rgbaToHex(l.stroke.fill.color) : "#000000"} disabled={!l.stroke} oninput={(e) => setStroke({ color: e.currentTarget.value })} aria-label="Stroke color" /><label class="chk"><input type="checkbox" checked={!!l.stroke} onchange={(e) => setStroke({ enabled: e.currentTarget.checked, width: 2 })} /> On</label></span></div>
        <div class="row"><span class="lbl">Width</span><ScrubbyNumber unit="px" min={0} max={200} value={l.stroke?.width ?? 0} disabled={!l.stroke} width={48} onchange={(v) => setStroke({ width: v })} /></div>
        <div class="row"><span class="lbl">Align</span><PsSelect value={l.stroke?.position ?? "center"} choices={STROKE_POS} width={90} disabled={!l.stroke} onchange={(v) => setStroke({ position: v as "inside" | "outside" | "center" })} /></div>
        <div class="row"><span class="lbl">Path</span><span class="val mono">{l.path.subpaths.length} subpath{l.path.subpaths.length === 1 ? "" : "s"}, {l.path.subpaths.reduce((n, s) => n + s.anchors.length, 0)} anchors</span></div>
      </section>
      <section class="btns">
        <button type="button" class="btn" onclick={() => void runCommand("layer.rasterize.shape")}>Rasterize Shape</button>
      </section>
    {/if}
  {:else}
    <div class="empty">Open a document to see its properties.</div>
  {/if}
</div>

<style>
  .props {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--fs-sm);
    color: var(--ps-text);
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border-bottom: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 -1px 0 var(--ps-border-light);
  }
  .hicon {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    background: var(--ps-panel-head);
    border: 1px solid var(--ps-border-dark);
    color: var(--ps-text);
  }
  .htitle {
    font-weight: 600;
  }
  section {
    flex: none;
    padding: 6px 8px 8px;
    border-bottom: 1px solid var(--ps-border-dark);
  }
  section.adj {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  h4 {
    margin: 0 0 4px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--ps-text);
  }
  .row {
    display: grid;
    grid-template-columns: 62px 1fr;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .lbl {
    color: var(--ps-text-dim);
  }
  .val {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-variant-numeric: tabular-nums;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 8px;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
  }
  .tools :global(.rot) {
    transform: rotate(90deg);
  }
  .sep {
    width: 1px;
    height: 14px;
    margin: 0 4px;
    background: var(--ps-border-light);
  }
  .prow {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 6px;
    margin: 4px 0 2px;
  }
  .plbl {
    color: var(--ps-text-dim);
  }
  .pval {
    text-align: right;
    color: var(--ps-text);
  }
  .prange {
    grid-column: 1 / -1;
    width: 100%;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 20px;
  }
  .swatch {
    width: 40px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--ps-border-dark);
    background: none;
    vertical-align: middle;
  }
  .gbar {
    display: inline-block;
    height: 16px;
    border: 1px solid var(--ps-border-dark);
  }
  .tb {
    display: grid;
    place-items: center;
    width: 20px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .tb.on {
    background: var(--ps-active);
    color: var(--ps-text);
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 6px;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--ps-text-disabled);
    font-size: var(--fs-xs);
  }
  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    height: 24px;
    padding: 0 6px;
    margin-top: auto;
    border-top: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 1px 0 var(--ps-border-light);
  }
  .empty {
    padding: 14px 10px;
    color: var(--ps-text-dim);
  }
</style>
