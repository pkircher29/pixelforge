<script lang="ts">
  /**
   * Layer Style dialog — Photoshop layout: effect list with checkboxes on the left,
   * the selected effect's PS parameter groups in the middle, OK / Cancel / New Style /
   * Preview on the right. Edits are applied live to the layer (direct mutation +
   * `docStore.touch`, like the adjustment dialogs); OK restores the original and
   * pushes one `SetLayerEffectsCommand` (plus a `SetLayerPropsCommand` for the
   * Blending Options page) so the whole session is a single undo step; Cancel restores.
   */
  import { onDestroy, onMount } from "svelte";
  import { SetLayerEffectsCommand, SetLayerPropsCommand, cloneEffects, type BlendMode, type LayerEffects, type RGBA } from "$lib/engine";
  import { docStore } from "$lib/stores/doc.svelte";
  import Dialog from "./Dialog.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import Icon from "../icons/Icon.svelte";
  import LayerStyleAngleDial from "./LayerStyleAngleDial.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { drawRasterToCanvas } from "../panels/thumbnail";
  import {
    STYLE_PAGES,
    STYLE_LABEL,
    DISABLED_PAGES,
    BLEND_CHOICES,
    toggleEffect,
    setEffectField,
    syncGlobalLight,
    emptyEffects,
    effectDefault,
    makeDefault,
    resetDefault,
    applyPreset,
    renderStylePreview,
    rgbaToHex,
    hexToRgba,
    normAngle,
    type StyleKey,
    type StylePage,
    type StylePreset,
  } from "./layer-style-model";
  import { STYLE_PRESETS } from "./layer-style-presets";

  interface Props {
    layerId: string;
    page?: StylePage;
    resolve: Resolver<boolean>;
  }
  let { layerId, page: initialPage = "blending", resolve }: Props = $props();

  const entry = docStore.active;
  const layer = entry?.doc.layers.find((l) => l.id === layerId) ?? null;
  const original: LayerEffects | null = layer ? cloneEffects(layer.effects) : null;
  const origProps = layer ? { blendMode: layer.blendMode, opacity: layer.opacity, fillOpacity: layer.fillOpacity } : null;

  // svelte-ignore state_referenced_locally
  let page = $state<StylePage>(initialPage);
  let effects = $state<LayerEffects>(cloneEffects(original) ?? emptyEffects());
  let blendMode = $state<BlendMode>(origProps?.blendMode ?? ("normal" as BlendMode));
  let opacity = $state(Math.round((origProps?.opacity ?? 1) * 100));
  let fillOpacity = $state(Math.round((origProps?.fillOpacity ?? 1) * 100));
  let preview = $state(true);
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let closed = false;
  let userPresets = $state<StylePreset[]>([]);

  const title = $derived(layer ? `Layer Style — ${layer.name}` : "Layer Style");
  const pageLabel = $derived(page === "styles" ? "Styles" : page === "blending" ? "Blending Options" : STYLE_LABEL[page]);

  // ---------------------------------------------------------------- live apply

  function applyLive(): void {
    if (!layer || closed) return;
    layer.effects = preview ? cloneEffects(effects) : cloneEffects(original);
    if (preview) {
      layer.blendMode = blendMode;
      layer.opacity = opacity / 100;
      layer.fillOpacity = fillOpacity / 100;
    } else if (origProps) {
      layer.blendMode = origProps.blendMode;
      layer.opacity = origProps.opacity;
      layer.fillOpacity = origProps.fillOpacity;
    }
    docStore.touch();
  }

  function restore(): void {
    if (!layer) return;
    layer.effects = cloneEffects(original);
    if (origProps) {
      layer.blendMode = origProps.blendMode;
      layer.opacity = origProps.opacity;
      layer.fillOpacity = origProps.fillOpacity;
    }
  }

  function set(next: LayerEffects): void {
    effects = next;
    applyLive();
  }

  onMount(() => {
    if (!layer) {
      resolve(null);
      return;
    }
    if (page !== "styles" && page !== "blending" && !effects[page]?.enabled) effects = toggleEffect(effects, page, true);
    applyLive();
  });

  onDestroy(() => {
    if (!closed) restore();
  });

  function ok(): void {
    if (closed) return;
    closed = true;
    if (layer) {
      restore();
      docStore.exec(new SetLayerEffectsCommand(layerId, $state.snapshot(effects), "Layer Style"), { noMerge: true });
      if (origProps && (blendMode !== origProps.blendMode || opacity / 100 !== origProps.opacity || fillOpacity / 100 !== origProps.fillOpacity)) {
        docStore.exec(new SetLayerPropsCommand(layerId, { blendMode, opacity: opacity / 100, fillOpacity: fillOpacity / 100 }, "Blending Options"), { noMerge: true });
      }
    }
    resolve(true);
  }

  function cancel(): void {
    if (closed) return;
    closed = true;
    restore();
    docStore.touch();
    resolve(null);
  }

  // ---------------------------------------------------------------- preview thumb

  $effect(() => {
    const el = previewCanvas;
    const snap = $state.snapshot(effects);
    if (!el) return;
    const t = setTimeout(() => drawRasterToCanvas(el, renderStylePreview(snap, 48)), 60);
    return () => clearTimeout(t);
  });

  // ---------------------------------------------------------------- field helpers

  function fx<K extends StyleKey>(key: K): NonNullable<LayerEffects[K]> {
    return (effects[key] ?? effectDefault(key)) as NonNullable<LayerEffects[K]>;
  }
  function patch<K extends StyleKey>(key: K, p: Partial<NonNullable<LayerEffects[K]>>): void {
    let next = setEffectField(effects, key, p);
    if ("useGlobalLight" in p || "angle" in p || "altitude" in p) {
      const cur = next[key] as { useGlobalLight?: boolean; angle?: number; altitude?: number };
      if (cur.useGlobalLight) {
        if ("angle" in p && typeof cur.angle === "number") next.globalLightAngle = normAngle(cur.angle);
        if ("altitude" in p && typeof cur.altitude === "number") next.globalLightAltitude = cur.altitude;
        next = syncGlobalLight(next);
      }
    }
    set(next);
  }
  function toggle(key: StyleKey, on: boolean): void {
    set(toggleEffect(effects, key, on));
  }
  function color(c: RGBA): string {
    return rgbaToHex(c);
  }
  function pct(v: number): number {
    return Math.round(v * 100);
  }
  function onMakeDefault(): void {
    if (page !== "styles" && page !== "blending") makeDefault(page, $state.snapshot(effects[page]) as NonNullable<LayerEffects[StyleKey]>);
  }
  function onResetDefault(): void {
    if (page === "styles" || page === "blending") return;
    resetDefault(page);
    set(setEffectField(effects, page, { ...effectDefault(page), enabled: true }));
  }
  function usePreset(p: StylePreset): void {
    set(applyPreset(effects, p));
  }
  function newStyle(): void {
    const name = window.prompt("Style name:", `Style ${STYLE_PRESETS.length + userPresets.length}`);
    if (!name) return;
    userPresets.push({ id: `user-${Date.now().toString(36)}`, name, effects: cloneEffects($state.snapshot(effects)) ?? {} });
    page = "styles";
  }

  const POSITIONS = [
    { value: "outside", label: "Outside" },
    { value: "inside", label: "Inside" },
    { value: "center", label: "Center" },
  ];
  const FILL_TYPES = [
    { value: "color", label: "Color" },
    { value: "gradient", label: "Gradient" },
  ];
  const GRADIENT_STYLES = ["linear", "radial", "angle", "reflected", "diamond"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));
  const BEVEL_STYLES = [
    { value: "outerBevel", label: "Outer Bevel" },
    { value: "innerBevel", label: "Inner Bevel" },
    { value: "emboss", label: "Emboss" },
    { value: "pillowEmboss", label: "Pillow Emboss" },
  ];
  const TECHNIQUES = [
    { value: "smooth", label: "Smooth" },
    { value: "chiselHard", label: "Chisel Hard" },
    { value: "chiselSoft", label: "Chisel Soft" },
  ];
  const GLOW_TECH = [
    { value: "softer", label: "Softer" },
    { value: "precise", label: "Precise" },
  ];
  const SOURCES = [
    { value: "center", label: "Center" },
    { value: "edge", label: "Edge" },
  ];
</script>

{#snippet slider(label: string, value: number, min: number, max: number, unit: string, onchange: (v: number) => void, step = 1)}
  <div class="srow">
    <span class="sl">{label}:</span>
    <input type="range" {min} {max} {step} {value} oninput={(e) => onchange(Number(e.currentTarget.value))} aria-label={label} />
    <input class="input num" type="number" {min} {max} {step} {value} onchange={(e) => onchange(Math.max(min, Math.min(max, Number(e.currentTarget.value))))} aria-label={label} />
    <span class="unit">{unit}</span>
  </div>
{/snippet}

{#snippet blendRow(mode: BlendMode, col: RGBA | null, onmode: (m: BlendMode) => void, oncolor: ((c: RGBA) => void) | null, label = "Blend Mode")}
  <div class="srow">
    <span class="sl">{label}:</span>
    <span class="inline">
      <PsSelect value={mode} choices={BLEND_CHOICES} width={120} onchange={(v) => onmode(v as BlendMode)} />
      {#if col && oncolor}
        <input type="color" class="swatch" value={color(col)} oninput={(e) => { const c = hexToRgba(e.currentTarget.value); if (c) oncolor(c); }} aria-label="Color" />
      {/if}
    </span>
  </div>
{/snippet}

{#snippet angleRow(angle: number, useGlobal: boolean, onangle: (a: number) => void, onglobal: (g: boolean) => void)}
  <div class="srow">
    <span class="sl">Angle:</span>
    <span class="inline">
      <LayerStyleAngleDial value={angle} size={32} onchange={(a) => onangle(a)} />
      <input class="input num" type="number" min="-180" max="180" value={angle} onchange={(e) => onangle(normAngle(Number(e.currentTarget.value)))} aria-label="Angle" />
      <span class="unit">°</span>
      <label class="chk"><input type="checkbox" checked={useGlobal} onchange={(e) => onglobal(e.currentTarget.checked)} /> Use Global Light</label>
    </span>
  </div>
{/snippet}

<Dialog {title} width={780} oncancel={cancel} onsubmit={ok} dim={false}>
  <div class="body">
    <!-- Left column -->
    <div class="col">
      <button type="button" class="pg" class:on={page === "styles"} onclick={() => (page = "styles")}>Styles</button>
      <button type="button" class="pg" class:on={page === "blending"} onclick={() => (page = "blending")}>Blending Options</button>
      {#each STYLE_PAGES as k (k)}
        <div class="pg fxrow" class:on={page === k}>
          <input type="checkbox" checked={!!effects[k]?.enabled} onchange={(e) => toggle(k, e.currentTarget.checked)} aria-label="Enable {STYLE_LABEL[k]}" />
          <button type="button" class="pgl" onclick={() => (page = k)}>{STYLE_LABEL[k]}</button>
          <button type="button" class="plus" disabled aria-label="Add another instance" title="Multiple instances arrive later"><Icon name="plus" size={10} /></button>
        </div>
        {#each DISABLED_PAGES.filter((d) => d.after === k) as d (d.label)}
          <div class="pg fxrow disabled"><input type="checkbox" disabled /><span class="pgl">{d.label}</span></div>
        {/each}
      {/each}
    </div>

    <!-- Middle pane -->
    <div class="pane">
      <h3>{pageLabel}</h3>
      {#if page === "styles"}
        <div class="presets">
          {#each [...STYLE_PRESETS, ...userPresets] as p (p.id)}
            <button type="button" class="preset" title={p.name} aria-label={p.name} onclick={() => usePreset(p)}>
              {#key p.id}<canvas class="pc" use:thumb={p}></canvas>{/key}
            </button>
          {/each}
        </div>
      {:else if page === "blending"}
        <fieldset class="ps-group">
          <legend>General Blending</legend>
          {@render blendRow(blendMode, null, (m) => { blendMode = m; applyLive(); }, null)}
          {@render slider("Opacity", opacity, 0, 100, "%", (v) => { opacity = v; applyLive(); })}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Advanced Blending</legend>
          {@render slider("Fill Opacity", fillOpacity, 0, 100, "%", (v) => { fillOpacity = v; applyLive(); })}
          <label class="chk"><input type="checkbox" checked={effects.dropShadow?.knockout ?? true} onchange={(e) => patch("dropShadow", { knockout: e.currentTarget.checked })} /> Layer Knocks Out Drop Shadow</label>
        </fieldset>
      {:else if page === "dropShadow"}
        {@const e = fx("dropShadow")}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          {@render blendRow(e.blendMode, e.color, (m) => patch("dropShadow", { blendMode: m }), (c) => patch("dropShadow", { color: c }))}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("dropShadow", { opacity: v / 100 }))}
          {@render angleRow(e.angle, e.useGlobalLight, (a) => patch("dropShadow", { angle: a }), (g) => patch("dropShadow", { useGlobalLight: g, angle: g ? (effects.globalLightAngle ?? 120) : e.angle }))}
          {@render slider("Distance", e.distance, 0, 250, "px", (v) => patch("dropShadow", { distance: v }))}
          {@render slider("Spread", e.spread, 0, 100, "%", (v) => patch("dropShadow", { spread: v }))}
          {@render slider("Size", e.size, 0, 250, "px", (v) => patch("dropShadow", { size: v }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Quality</legend>
          <div class="srow"><span class="sl">Contour:</span><span class="dim">Linear (fixed)</span></div>
          <div class="srow"><span class="sl">Noise:</span><span class="dim">0 % (fixed)</span></div>
          <label class="chk"><input type="checkbox" checked={e.knockout} onchange={(ev) => patch("dropShadow", { knockout: ev.currentTarget.checked })} /> Layer Knocks Out Drop Shadow</label>
        </fieldset>
      {:else if page === "innerShadow"}
        {@const e = fx("innerShadow")}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          {@render blendRow(e.blendMode, e.color, (m) => patch("innerShadow", { blendMode: m }), (c) => patch("innerShadow", { color: c }))}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("innerShadow", { opacity: v / 100 }))}
          {@render angleRow(e.angle, e.useGlobalLight, (a) => patch("innerShadow", { angle: a }), (g) => patch("innerShadow", { useGlobalLight: g, angle: g ? (effects.globalLightAngle ?? 120) : e.angle }))}
          {@render slider("Distance", e.distance, 0, 250, "px", (v) => patch("innerShadow", { distance: v }))}
          {@render slider("Choke", e.choke, 0, 100, "%", (v) => patch("innerShadow", { choke: v }))}
          {@render slider("Size", e.size, 0, 250, "px", (v) => patch("innerShadow", { size: v }))}
        </fieldset>
      {:else if page === "outerGlow"}
        {@const e = fx("outerGlow")}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          {@render blendRow(e.blendMode, e.color, (m) => patch("outerGlow", { blendMode: m }), (c) => patch("outerGlow", { color: c }))}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("outerGlow", { opacity: v / 100 }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Elements</legend>
          <div class="srow"><span class="sl">Technique:</span><PsSelect value="softer" choices={GLOW_TECH} width={100} onchange={() => {}} disabled /></div>
          {@render slider("Spread", e.spread, 0, 100, "%", (v) => patch("outerGlow", { spread: v }))}
          {@render slider("Size", e.size, 0, 250, "px", (v) => patch("outerGlow", { size: v }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Quality</legend>
          <div class="srow"><span class="sl">Range:</span><span class="dim">50 % (fixed)</span></div>
        </fieldset>
      {:else if page === "innerGlow"}
        {@const e = fx("innerGlow")}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          {@render blendRow(e.blendMode, e.color, (m) => patch("innerGlow", { blendMode: m }), (c) => patch("innerGlow", { color: c }))}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("innerGlow", { opacity: v / 100 }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Elements</legend>
          <div class="srow"><span class="sl">Technique:</span><PsSelect value="softer" choices={GLOW_TECH} width={100} onchange={() => {}} disabled /></div>
          <div class="srow"><span class="sl">Source:</span><PsSelect value={e.source} choices={SOURCES} width={100} onchange={(v) => patch("innerGlow", { source: v as "center" | "edge" })} /></div>
          {@render slider("Choke", e.choke, 0, 100, "%", (v) => patch("innerGlow", { choke: v }))}
          {@render slider("Size", e.size, 0, 250, "px", (v) => patch("innerGlow", { size: v }))}
        </fieldset>
      {:else if page === "bevelEmboss"}
        {@const e = fx("bevelEmboss")}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          <div class="srow"><span class="sl">Style:</span><PsSelect value={e.style} choices={BEVEL_STYLES} width={120} onchange={(v) => patch("bevelEmboss", { style: v as typeof e.style })} /></div>
          <div class="srow"><span class="sl">Technique:</span><PsSelect value={e.technique} choices={TECHNIQUES} width={120} onchange={(v) => patch("bevelEmboss", { technique: v as typeof e.technique })} /></div>
          {@render slider("Depth", e.depth, 1, 1000, "%", (v) => patch("bevelEmboss", { depth: v }))}
          <div class="srow"><span class="sl">Direction:</span><span class="inline"><label class="chk"><input type="radio" name="dir" checked={e.direction === "up"} onchange={() => patch("bevelEmboss", { direction: "up" })} /> Up</label><label class="chk"><input type="radio" name="dir" checked={e.direction === "down"} onchange={() => patch("bevelEmboss", { direction: "down" })} /> Down</label></span></div>
          {@render slider("Size", e.size, 0, 250, "px", (v) => patch("bevelEmboss", { size: v }))}
          {@render slider("Soften", e.soften, 0, 16, "px", (v) => patch("bevelEmboss", { soften: v }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Shading</legend>
          <div class="srow">
            <span class="sl">Angle:</span>
            <span class="inline">
              <LayerStyleAngleDial value={e.angle} altitude={e.altitude} size={32} onchange={(a, alt) => patch("bevelEmboss", { angle: a, altitude: alt ?? e.altitude })} />
              <input class="input num" type="number" min="-180" max="180" value={e.angle} onchange={(ev) => patch("bevelEmboss", { angle: normAngle(Number(ev.currentTarget.value)) })} aria-label="Angle" /><span class="unit">°</span>
              <label class="chk"><input type="checkbox" checked={e.useGlobalLight} onchange={(ev) => patch("bevelEmboss", { useGlobalLight: ev.currentTarget.checked, angle: ev.currentTarget.checked ? (effects.globalLightAngle ?? 120) : e.angle })} /> Use Global Light</label>
            </span>
          </div>
          <div class="srow"><span class="sl">Altitude:</span><span class="inline"><input class="input num" type="number" min="0" max="90" value={e.altitude} onchange={(ev) => patch("bevelEmboss", { altitude: Math.max(0, Math.min(90, Number(ev.currentTarget.value))) })} aria-label="Altitude" /><span class="unit">°</span></span></div>
          {@render blendRow(e.highlightMode, e.highlightColor, (m) => patch("bevelEmboss", { highlightMode: m }), (c) => patch("bevelEmboss", { highlightColor: c }), "Highlight Mode")}
          {@render slider("Opacity", pct(e.highlightOpacity), 0, 100, "%", (v) => patch("bevelEmboss", { highlightOpacity: v / 100 }))}
          {@render blendRow(e.shadowMode, e.shadowColor, (m) => patch("bevelEmboss", { shadowMode: m }), (c) => patch("bevelEmboss", { shadowColor: c }), "Shadow Mode")}
          {@render slider("Opacity", pct(e.shadowOpacity), 0, 100, "%", (v) => patch("bevelEmboss", { shadowOpacity: v / 100 }))}
        </fieldset>
      {:else if page === "colorOverlay"}
        {@const e = fx("colorOverlay")}
        <fieldset class="ps-group">
          <legend>Color</legend>
          {@render blendRow(e.blendMode, e.color, (m) => patch("colorOverlay", { blendMode: m }), (c) => patch("colorOverlay", { color: c }))}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("colorOverlay", { opacity: v / 100 }))}
        </fieldset>
      {:else if page === "gradientOverlay"}
        {@const e = fx("gradientOverlay")}
        {@const first = e.gradient.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }}
        {@const last = e.gradient.stops[e.gradient.stops.length - 1]?.color ?? { r: 255, g: 255, b: 255, a: 255 }}
        <fieldset class="ps-group">
          <legend>Gradient</legend>
          {@render blendRow(e.blendMode, null, (m) => patch("gradientOverlay", { blendMode: m }), null)}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("gradientOverlay", { opacity: v / 100 }))}
          <div class="srow">
            <span class="sl">Gradient:</span>
            <span class="inline">
              <input type="color" class="swatch" value={color(first)} oninput={(ev) => { const c = hexToRgba(ev.currentTarget.value); if (c) patch("gradientOverlay", { gradient: { stops: [{ pos: 0, color: c }, { pos: 1, color: last }] } }); }} aria-label="Start color" />
              <span class="gbar" style:background="linear-gradient(90deg, {color(first)}, {color(last)})"></span>
              <input type="color" class="swatch" value={color(last)} oninput={(ev) => { const c = hexToRgba(ev.currentTarget.value); if (c) patch("gradientOverlay", { gradient: { stops: [{ pos: 0, color: first }, { pos: 1, color: c }] } }); }} aria-label="End color" />
              <label class="chk"><input type="checkbox" checked={e.reverse} onchange={(ev) => patch("gradientOverlay", { reverse: ev.currentTarget.checked })} /> Reverse</label>
            </span>
          </div>
          <div class="srow"><span class="sl">Style:</span><span class="inline"><PsSelect value={e.style} choices={GRADIENT_STYLES} width={100} onchange={(v) => patch("gradientOverlay", { style: v as typeof e.style })} /><label class="chk"><input type="checkbox" checked={e.alignWithLayer} onchange={(ev) => patch("gradientOverlay", { alignWithLayer: ev.currentTarget.checked })} /> Align with Layer</label></span></div>
          {@render angleRow(e.angle, false, (a) => patch("gradientOverlay", { angle: a }), () => {})}
          {@render slider("Scale", Math.round(e.scale * 100), 10, 150, "%", (v) => patch("gradientOverlay", { scale: v / 100 }))}
        </fieldset>
      {:else if page === "stroke"}
        {@const e = fx("stroke")}
        {@const gfirst = e.gradient?.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 255 }}
        {@const glast = e.gradient?.stops[e.gradient.stops.length - 1]?.color ?? { r: 255, g: 255, b: 255, a: 255 }}
        <fieldset class="ps-group">
          <legend>Structure</legend>
          {@render slider("Size", e.size, 1, 250, "px", (v) => patch("stroke", { size: v }))}
          <div class="srow"><span class="sl">Position:</span><PsSelect value={e.position} choices={POSITIONS} width={100} onchange={(v) => patch("stroke", { position: v as typeof e.position })} /></div>
          {@render blendRow(e.blendMode, null, (m) => patch("stroke", { blendMode: m }), null)}
          {@render slider("Opacity", pct(e.opacity), 0, 100, "%", (v) => patch("stroke", { opacity: v / 100 }))}
        </fieldset>
        <fieldset class="ps-group">
          <legend>Fill</legend>
          <div class="srow"><span class="sl">Fill Type:</span><PsSelect value={e.fillType} choices={FILL_TYPES} width={100} onchange={(v) => patch("stroke", { fillType: v as "color" | "gradient", gradient: v === "gradient" ? (e.gradient ?? { stops: [{ pos: 0, color: { r: 0, g: 0, b: 0, a: 255 } }, { pos: 1, color: { r: 255, g: 255, b: 255, a: 255 } }] }) : e.gradient })} /></div>
          {#if e.fillType === "color"}
            <div class="srow"><span class="sl">Color:</span><input type="color" class="swatch" value={color(e.color)} oninput={(ev) => { const c = hexToRgba(ev.currentTarget.value); if (c) patch("stroke", { color: c }); }} aria-label="Stroke color" /></div>
          {:else}
            <div class="srow">
              <span class="sl">Gradient:</span>
              <span class="inline">
                <input type="color" class="swatch" value={color(gfirst)} oninput={(ev) => { const c = hexToRgba(ev.currentTarget.value); if (c) patch("stroke", { gradient: { stops: [{ pos: 0, color: c }, { pos: 1, color: glast }] } }); }} aria-label="Start color" />
                <span class="gbar" style:background="linear-gradient(90deg, {color(gfirst)}, {color(glast)})"></span>
                <input type="color" class="swatch" value={color(glast)} oninput={(ev) => { const c = hexToRgba(ev.currentTarget.value); if (c) patch("stroke", { gradient: { stops: [{ pos: 0, color: gfirst }, { pos: 1, color: c }] } }); }} aria-label="End color" />
              </span>
            </div>
            <div class="srow"><span class="sl">Style:</span><PsSelect value={e.gradientStyle} choices={GRADIENT_STYLES} width={100} onchange={(v) => patch("stroke", { gradientStyle: v as typeof e.gradientStyle })} /></div>
            {@render angleRow(e.gradientAngle, false, (a) => patch("stroke", { gradientAngle: a }), () => {})}
          {/if}
        </fieldset>
      {/if}
      {#if page !== "styles" && page !== "blending"}
        <div class="defaults">
          <button type="button" class="btn" onclick={onMakeDefault}>Make Default</button>
          <button type="button" class="btn" onclick={onResetDefault}>Reset to Default</button>
        </div>
      {/if}
    </div>

    <!-- Right column -->
    <div class="actions">
      <button type="button" class="btn primary" onclick={ok}>OK</button>
      <button type="button" class="btn" onclick={cancel}>Cancel</button>
      <button type="button" class="btn" onclick={newStyle}>New Style…</button>
      <label class="chk"><input type="checkbox" bind:checked={preview} onchange={applyLive} /> Preview</label>
      <canvas class="pv" bind:this={previewCanvas} width="48" height="48" aria-hidden="true"></canvas>
    </div>
  </div>
</Dialog>

<script lang="ts" module>
  import { renderStylePreview as _render } from "./layer-style-model";
  import { drawRasterToCanvas as _draw } from "../panels/thumbnail";
  /** Svelte action: paint a preset thumbnail once. */
  function thumb(el: HTMLCanvasElement, preset: { effects: import("$lib/engine").LayerEffects }) {
    const t = setTimeout(() => _draw(el, _render(preset.effects, 48)), 0);
    return { destroy: () => clearTimeout(t) };
  }
</script>

<style>
  .body {
    display: grid;
    grid-template-columns: 170px 1fr 96px;
    gap: 10px;
    min-height: 420px;
  }
  .col {
    display: flex;
    flex-direction: column;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    padding: 2px 0;
    align-self: start;
  }
  .pg {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 6px;
    text-align: left;
    color: var(--ps-text);
  }
  .pg:hover {
    background: var(--ps-hover);
  }
  .pg.on {
    background: var(--ps-row-selected);
  }
  .pg.disabled {
    color: var(--ps-text-disabled);
  }
  .pgl {
    flex: 1;
    text-align: left;
    color: inherit;
  }
  .plus {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--ps-border-light);
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .plus:disabled {
    opacity: 0.35;
  }
  .pane {
    min-width: 0;
  }
  h3 {
    margin: 0 0 6px;
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .srow {
    display: grid;
    grid-template-columns: 76px 1fr auto auto;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .sl {
    text-align: right;
    color: var(--ps-text-dim);
    white-space: nowrap;
  }
  .srow input[type="range"] {
    width: 100%;
    min-width: 80px;
  }
  .num {
    width: 54px;
  }
  .unit {
    color: var(--ps-text-dim);
    width: 18px;
  }
  .dim {
    color: var(--ps-text-disabled);
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    grid-column: 2 / -1;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .swatch {
    width: 40px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--ps-border-dark);
    background: none;
  }
  .gbar {
    display: inline-block;
    width: 120px;
    height: 16px;
    border: 1px solid var(--ps-border-dark);
  }
  .defaults {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 10px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .actions .btn {
    width: 100%;
  }
  .pv {
    align-self: center;
    margin-top: 4px;
    border: 1px solid var(--ps-border-dark);
    outline: 1px solid var(--ps-border-light);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, 56px);
    gap: 6px;
    padding: 4px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
  }
  .preset {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border: 1px solid var(--ps-border-dark);
    background: var(--ps-panel-head);
  }
  .preset:hover {
    outline: 1px solid var(--ps-accent);
  }
  .pc {
    width: 48px;
    height: 48px;
  }
</style>
