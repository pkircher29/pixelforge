<script lang="ts">
  /** Fill Path / Fill Subpath (PS): Contents, Pattern, Opacity, Feather Radius, Anti-alias. */
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";
  import { builtinPatterns } from "$lib/tools/patterns";

  interface Props {
    resolve: Resolver<{ contents: string; pattern: string; opacity: number; feather: number; antialias: boolean }>;
  }
  let { resolve }: Props = $props();
  let contents = $state("fg");
  let pattern = $state("checker");
  let opacity = $state(100);
  let feather = $state(0);
  let antialias = $state(true);
  const ok = () => resolve({ contents, pattern, opacity: Math.max(1, Math.min(100, opacity)) / 100, feather: Math.max(0, feather), antialias });
</script>

<Dialog title="Fill Path" width={340} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <legend>Contents</legend>
    <label class="row"><span>Use:</span>
      <select class="input" bind:value={contents} data-autofocus>
        <option value="fg">Foreground Color</option>
        <option value="bg">Background Color</option>
        <option value="pattern">Pattern</option>
        <option value="black">Black</option>
        <option value="gray">50% Gray</option>
        <option value="white">White</option>
      </select>
    </label>
    {#if contents === "pattern"}
      <label class="row"><span>Pattern:</span>
        <select class="input" bind:value={pattern}>
          {#each builtinPatterns() as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </label>
    {/if}
  </fieldset>
  <fieldset class="ps-group">
    <legend>Blending</legend>
    <label class="row"><span>Opacity:</span><input class="input num" type="number" min="1" max="100" bind:value={opacity} /> %</label>
  </fieldset>
  <fieldset class="ps-group">
    <legend>Rendering</legend>
    <label class="row"><span>Feather Radius:</span><input class="input num" type="number" min="0" max="250" step="0.5" bind:value={feather} /> px</label>
    <label class="chk"><input type="checkbox" bind:checked={antialias} /> Anti-alias</label>
  </fieldset>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" onclick={ok}>OK</button>
  {/snippet}
</Dialog>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
  }
  .row span {
    width: 92px;
    color: var(--ps-text-dim);
  }
  .row select {
    flex: 1;
  }
  .num {
    width: 60px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  legend {
    color: var(--ps-text-dim);
    padding: 0 4px;
  }
</style>
