<script lang="ts">
  /** Dev page (`?icons`): every glyph at 1×, 2× and 4× on PS surfaces, for legibility checks. */
  import Icon from "./Icon.svelte";
  import { ICON_NAMES } from "./icons";

  const groups: { title: string; names: string[] }[] = [
    { title: "Tools", names: ICON_NAMES.slice(0, ICON_NAMES.indexOf("swap-colors")) },
    { title: "Toolbar extras", names: ICON_NAMES.slice(ICON_NAMES.indexOf("swap-colors"), ICON_NAMES.indexOf("preset-picker")) },
    { title: "Options bar", names: ICON_NAMES.slice(ICON_NAMES.indexOf("preset-picker"), ICON_NAMES.indexOf("eye")) },
    { title: "Layers panel", names: ICON_NAMES.slice(ICON_NAMES.indexOf("eye"), ICON_NAMES.indexOf("panel-menu")) },
    { title: "Panel tabs", names: ICON_NAMES.slice(ICON_NAMES.indexOf("panel-menu"), ICON_NAMES.indexOf("chevron-down")) },
    { title: "Misc", names: ICON_NAMES.slice(ICON_NAMES.indexOf("chevron-down")) },
  ];
  let scale = $state(1);
</script>

<div class="sheet">
  <header>
    <strong>Pixelforge glyphs</strong>
    <span>{ICON_NAMES.length} icons</span>
    <label>Scale <select bind:value={scale}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
  </header>
  {#each groups as g (g.title)}
    <section>
      <h2>{g.title} <small>{g.names.length}</small></h2>
      <div class="grid" style:--s={scale}>
        {#each g.names as n (n)}
          <div class="cell">
            <span class="box"><Icon name={n} size={16 * scale} /></span>
            <span class="box dim"><Icon name={n} size={16 * scale} /></span>
            <span class="name">{n}</span>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .sheet {
    position: fixed;
    inset: 0;
    overflow: auto;
    padding: 16px 20px 40px;
    background: #323232;
    color: #e6e6e6;
    font: 11px/1.4 "Segoe UI", sans-serif;
  }
  header {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-bottom: 12px;
  }
  header strong {
    font-size: 13px;
  }
  h2 {
    margin: 18px 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: #a0a0a0;
    border-bottom: 1px solid #1e1e1e;
    box-shadow: 0 1px 0 #474747;
    padding-bottom: 3px;
  }
  h2 small {
    font-weight: 400;
    color: #6b6b6b;
    margin-left: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(96px + 32px * var(--s)), 1fr));
    gap: 2px 8px;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
  }
  .box {
    display: grid;
    place-items: center;
    padding: 4px;
    background: #323232;
    border: 1px solid #1e1e1e;
    box-shadow: inset 0 0 0 1px #474747;
  }
  .box.dim {
    color: #a0a0a0;
    background: #262626;
  }
  .name {
    color: #a0a0a0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
