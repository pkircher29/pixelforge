<script lang="ts">
  /**
   * Paragraph panel (PS): alignment buttons; left indent moves the text origin (point
   * type has no box, so PS's indents act as an offset). Right / first-line indents and
   * space before / after need engine support and are shown disabled.
   */
  import Icon from "../icons/Icon.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import { applyTypePatch, currentTypeTarget } from "$lib/tools/ui/type-target.svelte";

  const t = $derived(currentTypeTarget());
  const s = $derived(t.spec);
  const ALIGNS = [
    { value: "left", icon: "align-left", title: "Left align text" },
    { value: "center", icon: "align-hcenter", title: "Center text" },
    { value: "right", icon: "align-right", title: "Right align text" },
  ] as const;
  let indent = $state(0);
  function setIndent(v: number) {
    const d = Math.round(v) - indent;
    indent = Math.round(v);
    if (d !== 0 && t.kind !== "defaults") applyTypePatch({ x: s.x + d });
  }
</script>

<div class="pp">
  <div class="aligns" role="radiogroup" aria-label="Alignment">
    {#each ALIGNS as a (a.value)}
      <button type="button" role="radio" class="b" class:on={s.align === a.value} aria-checked={s.align === a.value} aria-label={a.title} data-tip={a.title} onclick={() => applyTypePatch({ align: a.value })}>
        <Icon name={a.icon} size={16} />
      </button>
    {/each}
    <button type="button" class="b" disabled aria-label="Justify (paragraph type only)" data-tip="Justify needs paragraph (box) type"><Icon name="distribute-h" size={16} /></button>
  </div>
  <div class="grid">
    <ScrubbyNumber label="Indent left" value={indent} min={-2000} max={2000} unit="pt" width={44} disabled={t.kind === "defaults"} onchange={setIndent} />
    <ScrubbyNumber label="Indent right" value={0} min={0} max={0} unit="pt" width={44} disabled onchange={() => {}} />
    <ScrubbyNumber label="First line" value={0} min={0} max={0} unit="pt" width={44} disabled onchange={() => {}} />
    <ScrubbyNumber label="Space before" value={0} min={0} max={0} unit="pt" width={44} disabled onchange={() => {}} />
  </div>
  <label class="chk"><input type="checkbox" disabled /> Hyphenate</label>
</div>

<style>
  .pp {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 8px;
    font-size: var(--fs-sm);
  }
  .aligns {
    display: flex;
    gap: 1px;
  }
  .b {
    display: grid;
    place-items: center;
    width: 24px;
    height: 20px;
    border-radius: 2px;
    color: var(--ps-text-dim);
  }
  .b:hover:not(:disabled) {
    background: var(--ps-hover);
    color: var(--ps-text);
  }
  .b.on {
    background: var(--ps-active);
    color: var(--ps-text);
    box-shadow: inset 0 0 0 1px var(--ps-border-dark);
  }
  .b:disabled {
    opacity: 0.35;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ps-text-disabled);
  }
</style>
