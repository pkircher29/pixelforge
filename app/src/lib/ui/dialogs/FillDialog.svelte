<script lang="ts">
  /** Edit ▸ Fill… (Shift+F5): Contents, Blending (mode, opacity, preserve transparency). */
  import { BLEND_MODES_MENU, BLEND_MODE_LABEL, type BlendMode } from "$lib/engine";
  import { builtinPatterns } from "$lib/tools/patterns";
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import { openColorPicker } from "./color-picker";
  import { FILL_CONTENTS, getUserPatterns, normalizeFill, type FillContents, type FillOptions } from "../commands/fill-stroke";
  import { rgbToHex } from "../panels/color-model";

  interface Props {
    initial: FillOptions;
    /** History source available (a snapshot / state exists). */
    hasHistory?: boolean;
    resolve: Resolver<FillOptions>;
  }
  let { initial, hasHistory = true, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let o = $state<FillOptions>({ ...initial });

  const patterns = [...builtinPatterns().map((p) => ({ value: p.id, label: p.name })), ...getUserPatterns().map((p) => ({ value: p.id, label: p.name }))];
  const contents = FILL_CONTENTS.map((c) => ({ value: c.id, label: c.label }));
  const modes = BLEND_MODES_MENU.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] }));

  async function setContents(v: string): Promise<void> {
    o.contents = v as FillContents;
    if (v === "color") {
      const c = await openColorPicker(o.color, { title: "Color Picker (Fill Color)" });
      if (c) o.color = c;
    }
  }
  async function pickColor(): Promise<void> {
    const c = await openColorPicker(o.color, { title: "Color Picker (Fill Color)" });
    if (c) o.color = c;
  }
  function ok(): void {
    resolve(normalizeFill(o));
  }
</script>

<Dialog title="Fill" width={380} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <span class="legend">Contents</span>
    <div class="row">
      <span class="lbl">Contents:</span>
      <PsSelect value={o.contents} choices={contents} width={170} onchange={(v) => void setContents(v)} />
      {#if o.contents === "color"}
        <button type="button" class="well" style:background={rgbToHex(o.color)} aria-label="Fill color" onclick={() => void pickColor()}></button>
      {/if}
    </div>
    {#if o.contents === "pattern"}
      <div class="row">
        <span class="lbl">Custom Pattern:</span>
        <PsSelect value={o.patternId} choices={patterns} width={170} onchange={(v) => (o.patternId = v)} />
      </div>
    {/if}
    {#if o.contents === "history" && !hasHistory}
      <div class="row note">No history source — the first state is used.</div>
    {/if}
  </fieldset>
  <fieldset class="ps-group">
    <span class="legend">Blending</span>
    <div class="row">
      <span class="lbl">Mode:</span>
      <PsSelect value={o.mode} choices={modes} width={170} onchange={(v) => (o.mode = v as BlendMode)} />
    </div>
    <div class="row">
      <span class="lbl">Opacity:</span>
      <input class="input num" type="number" min="0" max="100" bind:value={o.opacity} data-autofocus />
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
  .lbl {
    width: 92px;
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
    width: 34px;
    height: 18px;
    border: 1px solid var(--ps-border-dark);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .note {
    color: var(--ps-text-dim);
    padding-left: 98px;
  }
</style>
