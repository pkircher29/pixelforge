<script lang="ts">
  /** Edit ▸ Stroke…: Stroke (width, color), Location (inside/center/outside), Blending. */
  import { BLEND_MODES, BLEND_MODE_LABEL, type BlendMode } from "$lib/engine";
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import { openColorPicker } from "./color-picker";
  import { normalizeStroke, type StrokeLocation, type StrokeOptions } from "../commands/fill-stroke";
  import { rgbToHex } from "../panels/color-model";

  interface Props {
    initial: StrokeOptions;
    resolve: Resolver<StrokeOptions>;
  }
  let { initial, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let o = $state<StrokeOptions>({ ...initial });
  const modes = BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] }));
  const locations: { id: StrokeLocation; label: string }[] = [
    { id: "inside", label: "Inside" },
    { id: "center", label: "Center" },
    { id: "outside", label: "Outside" },
  ];

  async function pickColor(): Promise<void> {
    const c = await openColorPicker(o.color, { title: "Color Picker (Stroke Color)" });
    if (c) o.color = c;
  }
  function ok(): void {
    resolve(normalizeStroke(o));
  }
</script>

<Dialog title="Stroke" width={360} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <span class="legend">Stroke</span>
    <div class="row">
      <span class="lbl">Width:</span>
      <input class="input num" type="number" min="1" max="250" bind:value={o.width} data-autofocus />
      <span class="unit">px</span>
    </div>
    <div class="row">
      <span class="lbl">Color:</span>
      <button type="button" class="well" style:background={rgbToHex(o.color)} aria-label="Stroke color" onclick={() => void pickColor()}></button>
    </div>
  </fieldset>
  <fieldset class="ps-group">
    <span class="legend">Location</span>
    <div class="row locs" role="radiogroup">
      {#each locations as l (l.id)}
        <label class="chk"><input type="radio" name="stroke-loc" checked={o.location === l.id} onchange={() => (o.location = l.id)} /> {l.label}</label>
      {/each}
    </div>
  </fieldset>
  <fieldset class="ps-group">
    <span class="legend">Blending</span>
    <div class="row">
      <span class="lbl">Mode:</span>
      <PsSelect value={o.mode} choices={modes} width={160} onchange={(v) => (o.mode = v as BlendMode)} />
    </div>
    <div class="row">
      <span class="lbl">Opacity:</span>
      <input class="input num" type="number" min="0" max="100" bind:value={o.opacity} />
      <span class="unit">%</span>
    </div>
    <div class="row">
      <span class="lbl"></span>
      <label class="chk"><input type="checkbox" bind:checked={o.preserveTransparency} /> Preserve Transparency</label>
    </div>
  </fieldset>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={ok}>OK</button>
  {/snippet}
</Dialog>

<style>
  fieldset {
    margin: 8px 0 12px;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
  }
  .locs {
    gap: 16px;
    padding-left: 20px;
  }
  .lbl {
    width: 60px;
    text-align: right;
    color: var(--ps-text);
  }
  .num {
    width: 52px;
  }
  .unit {
    color: var(--ps-text-dim);
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .well {
    width: 60px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
</style>
