<script lang="ts">
  /** PS "New Layer" dialog: Name, Use Previous Layer to Create Clipping Mask, Color, Mode, Opacity. */
  import Dialog from "./Dialog.svelte";
  import PsSelect from "../controls/PsSelect.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { BLEND_MODES_MENU, BLEND_MODE_LABEL, type BlendMode, type LayerColor } from "$lib/engine";

  export interface NewLayerResult {
    name: string;
    clip: boolean;
    color: LayerColor | null;
    blendMode: BlendMode;
    opacity: number;
  }
  interface Props {
    title?: string;
    name: string;
    /** Offer the clipping checkbox (there is a layer below). */
    canClip?: boolean;
    blendMode?: BlendMode;
    opacity?: number;
    color?: LayerColor | null;
    okLabel?: string;
    resolve: Resolver<NewLayerResult>;
  }
  let { title = "New Layer", name: initialName, canClip = true, blendMode: initialMode = "normal" as BlendMode, opacity: initialOpacity = 1, color: initialColor = null, okLabel = "OK", resolve }: Props = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(initialName);
  let clip = $state(false);
  // svelte-ignore state_referenced_locally
  let color = $state<string>(initialColor ?? "none");
  // svelte-ignore state_referenced_locally
  let mode = $state<BlendMode>(initialMode);
  // svelte-ignore state_referenced_locally
  let opacity = $state(Math.round(initialOpacity * 100));

  const COLORS = [
    { value: "none", label: "None" },
    { value: "red", label: "Red" },
    { value: "orange", label: "Orange" },
    { value: "yellow", label: "Yellow" },
    { value: "green", label: "Green" },
    { value: "blue", label: "Blue" },
    { value: "violet", label: "Violet" },
    { value: "gray", label: "Gray" },
  ];
  const MODES = BLEND_MODES_MENU.map((m) => ({ value: m, label: BLEND_MODE_LABEL[m] }));

  function submit() {
    resolve({ name: name.trim() || initialName, clip, color: color === "none" ? null : (color as LayerColor), blendMode: mode, opacity: Math.max(0, Math.min(100, opacity)) / 100 });
  }
</script>

<Dialog {title} width={400} oncancel={() => resolve(null)} onsubmit={submit}>
  <div class="grid">
    <label class="row"><span>Name:</span><input class="input" type="text" bind:value={name} data-autofocus /></label>
    <label class="row chk"><span></span><span class="c"><input type="checkbox" bind:checked={clip} disabled={!canClip} /> Use Previous Layer to Create Clipping Mask</span></label>
    <div class="row"><span>Color:</span><PsSelect value={color} choices={COLORS} width={110} onchange={(v) => (color = v)} /></div>
    <div class="row">
      <span>Mode:</span>
      <span class="inline">
        <PsSelect value={mode} choices={MODES} width={120} onchange={(v) => (mode = v as BlendMode)} />
        <ScrubbyNumber label="Opacity" unit="%" min={0} max={100} value={opacity} width={40} onchange={(v) => (opacity = v)} />
      </span>
    </div>
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={submit}>{okLabel}</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    text-align: right;
    color: var(--ps-text-dim);
  }
  .c {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .inline {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
</style>
