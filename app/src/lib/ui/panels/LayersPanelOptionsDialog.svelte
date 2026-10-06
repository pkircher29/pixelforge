<script lang="ts">
  /** Layers panel ≡ ▸ Panel Options…: thumbnail size and thumbnail contents. */
  import Dialog from "../dialogs/Dialog.svelte";
  import type { Resolver } from "../dialogs/dialogs.svelte";
  import { layersUi, type ThumbContents, type ThumbSize } from "./Layers.store.svelte";

  interface Props {
    resolve: Resolver<boolean>;
  }
  let { resolve }: Props = $props();
  let size = $state<ThumbSize>(layersUi.thumbSize);
  let contents = $state<ThumbContents>(layersUi.thumbContents);

  const SIZES: { v: ThumbSize; px: number }[] = [
    { v: "none", px: 0 },
    { v: "small", px: 14 },
    { v: "medium", px: 22 },
    { v: "large", px: 32 },
  ];

  function ok() {
    layersUi.setThumbSize(size);
    layersUi.setThumbContents(contents);
    resolve(true);
  }
</script>

<Dialog title="Layers Panel Options" width={320} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <legend>Thumbnail Size</legend>
    {#each SIZES as s (s.v)}
      <label class="opt"><input type="radio" name="tsize" checked={size === s.v} onchange={() => (size = s.v)} />{#if s.px}<span class="sq" style:width="{s.px * 1.4}px" style:height="{s.px}px"></span>{:else}<span class="none">None</span>{/if}</label>
    {/each}
  </fieldset>
  <fieldset class="ps-group">
    <legend>Thumbnail Contents</legend>
    <label class="opt"><input type="radio" name="tcont" checked={contents === "bounds"} onchange={() => (contents = "bounds")} /> Layer Bounds</label>
    <label class="opt"><input type="radio" name="tcont" checked={contents === "document"} onchange={() => (contents = "document")} /> Entire Document</label>
  </fieldset>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={ok}>OK</button>
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .ps-group {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 18px;
  }
  .sq {
    display: inline-block;
    background: #9a9a9a;
    border: 1px solid var(--ps-border-dark);
    outline: 1px solid #ddd;
    outline-offset: -2px;
  }
  .none {
    color: var(--ps-text-dim);
  }
</style>
