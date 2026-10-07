<script lang="ts">
  /** Stroke Path (PS): Tool dropdown + Simulate Pressure. */
  import Dialog from "./Dialog.svelte";
  import type { Resolver } from "./dialogs.svelte";

  interface Props {
    resolve: Resolver<{ tool: string; simulatePressure: boolean }>;
  }
  let { resolve }: Props = $props();
  let tool = $state("brush");
  let simulatePressure = $state(false);
  const TOOLS = [
    { value: "brush", label: "Brush" },
    { value: "pencil", label: "Pencil" },
    { value: "eraser", label: "Eraser" },
    { value: "smudge", label: "Smudge" },
    { value: "blur", label: "Blur" },
    { value: "sharpen", label: "Sharpen" },
    { value: "dodge", label: "Dodge" },
    { value: "burn", label: "Burn" },
    { value: "sponge", label: "Sponge" },
  ];
  const ok = () => resolve({ tool, simulatePressure });
</script>

<Dialog title="Stroke Path" width={300} oncancel={() => resolve(null)} onsubmit={ok}>
  <label class="row"><span>Tool:</span>
    <select class="input" bind:value={tool} data-autofocus>
      {#each TOOLS as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
    </select>
  </label>
  <label class="chk"><input type="checkbox" bind:checked={simulatePressure} /> Simulate Pressure</label>
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
  }
  .row .input {
    flex: 1;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
</style>
