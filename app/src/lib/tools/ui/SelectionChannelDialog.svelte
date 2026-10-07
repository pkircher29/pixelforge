<script lang="ts">
  /**
   * Select ▸ Save Selection / Load Selection (PS): Destination/Source channel, name (save
   * to New), Invert (load), Operation (New / Add / Subtract / Intersect).
   */
  import Dialog from "$lib/ui/dialogs/Dialog.svelte";
  import type { Resolver } from "$lib/ui/dialogs/dialogs.svelte";
  import type { SelectionCombineMode } from "$lib/engine";
  import type { ChannelChoice, SelectionChannelResult } from "../select-ops";

  interface Props {
    kind: "save" | "load";
    channels: ChannelChoice[];
    hasSelection: boolean;
    defaultName: string;
    resolve: Resolver<SelectionChannelResult>;
  }
  let { kind, channels, hasSelection, defaultName, resolve }: Props = $props();
  // svelte-ignore state_referenced_locally
  let channelId = $state<string>(kind === "save" ? "new" : (channels[0]?.id ?? ""));
  // svelte-ignore state_referenced_locally
  let name = $state(defaultName);
  let invert = $state(false);
  let mode = $state<SelectionCombineMode>("replace");

  function ok() {
    if (kind === "load" && !channelId) return;
    resolve({ channelId: channelId === "new" ? null : channelId, name: name.trim() || defaultName, invert, mode });
  }
  const ops = $derived(
    kind === "save"
      ? [
          { value: "replace", label: "New Channel" },
          { value: "add", label: "Add to Channel" },
          { value: "subtract", label: "Subtract from Channel" },
          { value: "intersect", label: "Intersect with Channel" },
        ]
      : [
          { value: "replace", label: "New Selection" },
          { value: "add", label: "Add to Selection" },
          { value: "subtract", label: "Subtract from Selection" },
          { value: "intersect", label: "Intersect with Selection" },
        ],
  );
</script>

<Dialog title={kind === "save" ? "Save Selection" : "Load Selection"} width={380} oncancel={() => resolve(null)} onsubmit={ok}>
  <fieldset class="ps-group">
    <legend>{kind === "save" ? "Destination" : "Source"}</legend>
    <label class="row"><span class="lab">Channel:</span>
      <select class="input" bind:value={channelId}>
        {#if kind === "save"}<option value="new">New</option>{/if}
        {#each channels as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>
    {#if kind === "save"}
      <label class="row"><span class="lab">Name:</span><input class="input" type="text" bind:value={name} disabled={channelId !== "new"} /></label>
    {:else}
      <label class="chk"><input type="checkbox" bind:checked={invert} /> Invert</label>
    {/if}
  </fieldset>
  <fieldset class="ps-group">
    <legend>Operation</legend>
    {#each ops as o, i (o.value)}
      <label class="chk"><input type="radio" name="op" value={o.value} bind:group={mode} disabled={i > 0 && (kind === "save" ? channelId === "new" : !hasSelection)} /> {o.label}</label>
    {/each}
  </fieldset>
  {#if kind === "load" && channels.length === 0}
    <p class="hint">No saved selections yet. Use Select ▸ Save Selection first.</p>
  {/if}
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => resolve(null)}>Cancel</button>
    <button type="button" class="btn primary" disabled={kind === "load" && channels.length === 0} onclick={ok}>OK</button>
  {/snippet}
</Dialog>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .row .input {
    flex: 1;
  }
  .lab {
    width: 60px;
    color: var(--ps-text-dim);
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
  }
  legend {
    color: var(--ps-text-dim);
    padding: 0 4px;
  }
  .hint {
    color: var(--ps-text-dim);
    margin: 8px 0 0;
  }
</style>
