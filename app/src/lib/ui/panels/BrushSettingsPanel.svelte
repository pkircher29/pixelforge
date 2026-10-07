<script lang="ts">
  /**
   * Brush Settings (PS F5): section list on the left (Brush Tip Shape, Shape Dynamics,
   * Scattering, Transfer, Smoothing, Build-up) with enable checkboxes, the selected
   * section's controls on the right, and a live stroke preview strip along the bottom.
   */
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import { brushStore } from "$lib/tools/brush-store.svelte";
  import { allTips, tipFromRaster } from "$lib/tools/brush-tips";
  import { drawStrokePreview, drawTipPreview } from "$lib/tools/ui/brush-thumb";
  import { Raster } from "$lib/engine";
  import type { BrushSettings } from "$lib/tools/brush-engine";

  type Section = "tip" | "shape" | "scatter" | "transfer" | "smoothing" | "buildup";
  let section = $state<Section>("tip");
  let strip = $state<HTMLCanvasElement | null>(null);
  let tipsVersion = $state(0);
  const s = $derived(brushStore.settings);
  const tips = $derived.by(() => {
    void tipsVersion;
    return allTips();
  });

  const SECTIONS: { id: Section; label: string; flag?: keyof BrushSettings }[] = [
    { id: "tip", label: "Brush Tip Shape" },
    { id: "shape", label: "Shape Dynamics", flag: "shapeDynamics" },
    { id: "scatter", label: "Scattering", flag: "scattering" },
    { id: "transfer", label: "Transfer", flag: "transfer" },
    { id: "buildup", label: "Build-up", flag: "buildUp" },
    { id: "smoothing", label: "Smoothing" },
  ];

  $effect(() => {
    void brushStore.version;
    if (strip) drawStrokePreview(strip, brushStore.settings, { color: "#e6e6e6", seed: 3 });
  });

  function tipThumb(el: HTMLCanvasElement, id: string) {
    const draw = () => drawTipPreview(el, { ...brushStore.settings, tip: id, angle: 0, roundness: 100, hardness: 100 }, { color: "#e6e6e6" });
    draw();
    return { update: draw };
  }
  function up(patch: Partial<BrushSettings>) {
    brushStore.update(patch);
  }
  function loadTip() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/png,image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const bmp = await createImageBitmap(f);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(bmp, 0, 0);
      const r = Raster.fromImageData(g.getImageData(0, 0, c.width, c.height));
      const tip = tipFromRaster(`png-${Date.now().toString(36)}`, f.name.replace(/\.[^.]+$/, ""), r);
      tipsVersion++;
      up({ tip: tip.id });
    };
    inp.click();
  }
</script>

<div class="bs">
  <div class="body">
    <nav class="sections" aria-label="Brush settings sections">
      <button type="button" class="presets" onclick={() => (section = "tip")}>Brush Presets</button>
      {#each SECTIONS as sec (sec.id)}
        <div class="sec" class:on={section === sec.id}>
          {#if sec.flag}
            <input type="checkbox" checked={Boolean(s[sec.flag])} aria-label="Enable {sec.label}" onchange={(e) => up({ [sec.flag!]: e.currentTarget.checked } as Partial<BrushSettings>)} />
          {:else}
            <span class="nochk"></span>
          {/if}
          <button type="button" class="seclabel" onclick={() => (section = sec.id)}>{sec.label}</button>
        </div>
      {/each}
    </nav>
    <div class="pane">
      {#if section === "tip"}
        <div class="tips" role="listbox" aria-label="Brush tips">
          {#each tips as t (t.id)}
            <button type="button" role="option" class="tip" class:on={t.id === s.tip} aria-selected={t.id === s.tip} title={t.name} onclick={() => up({ tip: t.id, spacing: t.spacing })}>
              <canvas use:tipThumb={t.id}></canvas>
            </button>
          {/each}
          <button type="button" class="tip add" title="Load a PNG as a brush tip (dark = paint)" aria-label="Load brush tip" onclick={loadTip}>+</button>
        </div>
        <ScrubbyNumber label="Size" value={s.size} min={1} max={2500} log unit="px" width={56} onchange={(v) => up({ size: v })} />
        <div class="row">
          <label class="chk"><input type="checkbox" checked={s.flipX} onchange={(e) => up({ flipX: e.currentTarget.checked })} /> Flip X</label>
          <label class="chk"><input type="checkbox" checked={s.flipY} onchange={(e) => up({ flipY: e.currentTarget.checked })} /> Flip Y</label>
        </div>
        <div class="row">
          <ScrubbyNumber label="Angle" value={s.angle} min={-180} max={180} unit="°" width={40} onchange={(v) => up({ angle: v })} />
          <ScrubbyNumber label="Roundness" value={s.roundness} min={1} max={100} unit="%" width={40} onchange={(v) => up({ roundness: v })} />
        </div>
        <ScrubbyNumber label="Hardness" value={s.hardness} min={0} max={100} unit="%" width={40} disabled={s.tip !== "round"} onchange={(v) => up({ hardness: v })} />
        <ScrubbyNumber label="Spacing" value={s.spacing} min={1} max={1000} unit="%" width={44} onchange={(v) => up({ spacing: v })} />
      {:else if section === "shape"}
        <ScrubbyNumber label="Size Jitter" value={s.sizeJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ sizeJitter: v, shapeDynamics: true })} />
        <label class="chk"><input type="checkbox" checked={s.pressureSize} onchange={(e) => up({ pressureSize: e.currentTarget.checked })} /> Control: Pen Pressure</label>
        <ScrubbyNumber label="Minimum Diameter" value={s.minDiameter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ minDiameter: v, shapeDynamics: true })} />
        <ScrubbyNumber label="Angle Jitter" value={s.angleJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ angleJitter: v, shapeDynamics: true })} />
        <ScrubbyNumber label="Roundness Jitter" value={s.roundnessJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ roundnessJitter: v, shapeDynamics: true })} />
      {:else if section === "scatter"}
        <div class="row">
          <ScrubbyNumber label="Scatter" value={s.scatter} min={0} max={1000} unit="%" width={44} onchange={(v) => up({ scatter: v, scattering: true })} />
          <label class="chk"><input type="checkbox" checked={s.scatterBoth} onchange={(e) => up({ scatterBoth: e.currentTarget.checked, scattering: true })} /> Both Axes</label>
        </div>
        <ScrubbyNumber label="Count" value={s.count} min={1} max={16} width={36} onchange={(v) => up({ count: v, scattering: true })} />
        <ScrubbyNumber label="Count Jitter" value={s.countJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ countJitter: v, scattering: true })} />
      {:else if section === "transfer"}
        <ScrubbyNumber label="Opacity Jitter" value={s.opacityJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ opacityJitter: v, transfer: true })} />
        <label class="chk"><input type="checkbox" checked={s.pressureOpacity} onchange={(e) => up({ pressureOpacity: e.currentTarget.checked, transfer: true })} /> Control: Pen Pressure</label>
        <ScrubbyNumber label="Flow Jitter" value={s.flowJitter} min={0} max={100} unit="%" width={40} onchange={(v) => up({ flowJitter: v, transfer: true })} />
      {:else if section === "buildup"}
        <p class="note">Dabs keep accumulating while the pointer rests (airbrush). Same as the Airbrush button in the options bar.</p>
      {:else}
        <ScrubbyNumber label="Smoothing" value={s.smoothing} min={0} max={100} unit="%" width={40} onchange={(v) => up({ smoothing: v })} />
        <p class="note">Pulled-string smoothing: the brush follows the pointer on a string so strokes come out steadier. The blue line on the canvas shows the string.</p>
      {/if}
    </div>
  </div>
  <canvas class="strip" bind:this={strip} aria-label="Stroke preview"></canvas>
</div>

<style>
  .bs {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--fs-sm);
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .sections {
    width: 124px;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    border-right: 1px solid var(--ps-border-dark);
    overflow: auto;
  }
  .presets {
    margin: 0 4px 4px;
    height: 20px;
    background: var(--ps-button);
    border: 1px solid var(--ps-border-dark);
    border-radius: 2px;
    color: var(--ps-text);
  }
  .sec {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 4px;
  }
  .sec.on {
    background: var(--ps-row-selected);
  }
  .nochk {
    width: 13px;
  }
  .seclabel {
    flex: 1;
    text-align: left;
    color: var(--ps-text);
    white-space: nowrap;
  }
  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px;
    overflow: auto;
  }
  .tips {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
    gap: 2px;
    padding: 2px;
    background: var(--ps-input);
    border: 1px solid var(--ps-border-dark);
    max-height: 104px;
    overflow: auto;
  }
  .tip {
    height: 30px;
    padding: 1px;
    border: 1px solid transparent;
    border-radius: 2px;
  }
  .tip canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .tip:hover {
    background: var(--ps-hover);
  }
  .tip.on {
    border-color: var(--ps-accent);
  }
  .tip.add {
    color: var(--ps-text-dim);
    font-size: 16px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ps-text);
  }
  .note {
    margin: 0;
    color: var(--ps-text-dim);
    line-height: 1.4;
  }
  .strip {
    flex: none;
    display: block;
    height: 46px;
    width: 100%;
    background: var(--ps-input);
    border-top: 1px solid var(--ps-border-dark);
  }
</style>
