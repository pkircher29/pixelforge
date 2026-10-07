<script lang="ts">
  /**
   * Paragraph formatting is stored on the text layer; width enables wrapped type.
   */
  import Icon from "../icons/Icon.svelte";
  import ScrubbyNumber from "../controls/ScrubbyNumber.svelte";
  import { applyTypePatch, currentTypeTarget } from "$lib/tools/ui/type-target.svelte";
  import type { TextSpec } from "$lib/engine";

  const t = $derived(currentTypeTarget());
  const s = $derived(t.spec);
  const ALIGNS = [
    { value: "left", icon: "align-left", title: "Left align text" },
    { value: "center", icon: "align-hcenter", title: "Center text" },
    { value: "right", icon: "align-right", title: "Right align text" },
  ] as const;
</script>

<div class="pp">
  <div class="aligns" role="radiogroup" aria-label="Alignment">
    {#each ALIGNS as a (a.value)}
      <button type="button" role="radio" class="b" class:on={s.align === a.value && (!s.justification || s.justification === "none")} aria-checked={s.align === a.value && (!s.justification || s.justification === "none")} aria-label={a.title} data-tip={a.title} onclick={() => applyTypePatch({ align: a.value, justification: "none" })}>
        <Icon name={a.icon} size={16} />
      </button>
    {/each}
  </div>
  <div class="grid">
    <ScrubbyNumber label="Width" value={s.paragraphWidth ?? 0} min={0} max={30000} unit="px" width={44} disabled={s.vertical} onchange={(v) => applyTypePatch({ paragraphWidth: v || null })} />
    <span>0 = point type</span>
    <ScrubbyNumber label="Indent left" value={s.indentLeft ?? 0} min={-2000} max={2000} unit="pt" width={44} onchange={(v) => applyTypePatch({ indentLeft: v })} />
    <ScrubbyNumber label="Indent right" value={s.indentRight ?? 0} min={-2000} max={2000} unit="pt" width={44} onchange={(v) => applyTypePatch({ indentRight: v })} />
    <ScrubbyNumber label="First line" value={s.firstLineIndent ?? 0} min={-2000} max={2000} unit="pt" width={44} onchange={(v) => applyTypePatch({ firstLineIndent: v })} />
    <ScrubbyNumber label="Space before" value={s.spaceBefore ?? 0} min={0} max={2000} unit="pt" width={44} onchange={(v) => applyTypePatch({ spaceBefore: v })} />
    <ScrubbyNumber label="Space after" value={s.spaceAfter ?? 0} min={0} max={2000} unit="pt" width={44} onchange={(v) => applyTypePatch({ spaceAfter: v })} />
  </div>
  <label>Justification
    <select class="input" value={s.justification ?? "none"} disabled={s.vertical || !s.paragraphWidth} onchange={(e) => applyTypePatch({ justification: e.currentTarget.value as NonNullable<TextSpec["justification"]> })}>
      <option value="none">None</option><option value="left">Last line left</option><option value="center">Last line centered</option><option value="right">Last line right</option><option value="all">Justify all lines</option>
    </select>
  </label>
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
    grid-template-columns: minmax(0, 1fr);
    gap: 4px 10px;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ps-text-disabled);
  }
</style>
