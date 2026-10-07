<script lang="ts">
  /**
   * Hidden text input for the Type tool. A near-invisible textarea sits at the text
   * origin and owns keyboard focus (so global shortcuts stay quiet and IME works); the
   * tool draws the caret / selection on the overlay from the session model.
   */
  import type { OpenDoc } from "$lib/stores/doc.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { toolStore } from "$lib/stores/tool.svelte";
  import { canvasHost } from "$lib/ui/canvas/host.svelte";
  import { typeSession } from "../type-session.svelte";
  import { selectionRange } from "../text-session";

  interface Props {
    entry: OpenDoc;
  }
  let { entry }: Props = $props();
  let ta = $state<HTMLTextAreaElement | null>(null);

  const pos = $derived.by(() => {
    void entry.version;
    void typeSession.version;
    const s = typeSession.spec;
    return entry.viewport.docToScreen({ x: s.x, y: s.y });
  });

  // Focus + caret blink.
  $effect(() => {
    const el = ta;
    if (!el || !typeSession.active) return;
    el.focus();
    const t = setInterval(() => canvasHost.invalidateOverlay(), 250);
    return () => clearInterval(t);
  });

  // Model → textarea (caret moved by clicking).
  $effect(() => {
    const el = ta;
    void typeSession.version;
    if (!el) return;
    const m = typeSession.model;
    if (el.value !== m.text) el.value = m.text;
    const { start, end } = selectionRange(m);
    if (el.selectionStart !== start || el.selectionEnd !== end) {
      try {
        el.setSelectionRange(start, end, m.caret < m.anchor ? "backward" : "forward");
      } catch {
        /* ignore */
      }
    }
  });

  // Options bar → live spec while editing.
  $effect(() => {
    if (!typeSession.active) return;
    const id = toolStore.activeToolId;
    const bag = toolStore.options[id] ?? {};
    const fg = toolStore.fg;
    const style = String(bag.style ?? "regular");
    const patch = {
      font: String(bag.family ?? typeSession.spec.font),
      size: Number(bag.size ?? typeSession.spec.size),
      bold: style === "bold" || style === "boldItalic",
      italic: style === "italic" || style === "boldItalic",
      align: String(bag.align ?? typeSession.spec.align) as "left" | "center" | "right",
      antialias: String(bag.antialias ?? "smooth") !== "none",
      color: { ...fg },
    };
    const s = typeSession.spec;
    if (patch.font !== s.font || patch.size !== s.size || patch.bold !== s.bold || patch.italic !== s.italic || patch.align !== s.align || patch.antialias !== s.antialias || patch.color.r !== s.color.r || patch.color.g !== s.color.g || patch.color.b !== s.color.b) {
      typeSession.update(patch);
    }
  });

  // Tool switch (ui.textEdit cleared by the host) → commit.
  $effect(() => {
    if (!ui.textEdit && typeSession.active) typeSession.commit();
  });

  function sync() {
    const el = ta;
    if (!el) return;
    typeSession.syncFromTextarea(el.value, el.selectionStart, el.selectionEnd, el.selectionDirection ?? "forward");
  }
  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      typeSession.cancel();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.code === "NumpadEnter")) {
      e.preventDefault();
      typeSession.commit();
      return;
    }
    if (e.key === "Tab") e.preventDefault();
    queueMicrotask(sync);
  }
</script>

<textarea
  class="type-input"
  bind:this={ta}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  wrap="off"
  spellcheck="false"
  autocomplete="off"
  autocapitalize="off"
  aria-label="Type tool text"
  oninput={sync}
  onkeydown={onKeyDown}
  onkeyup={sync}
  onselect={sync}
  onmouseup={sync}
></textarea>

<style>
  .type-input {
    position: absolute;
    width: 2px;
    height: 2px;
    padding: 0;
    border: 0;
    outline: none;
    opacity: 0.01;
    resize: none;
    overflow: hidden;
    background: transparent;
    color: transparent;
    caret-color: transparent;
    pointer-events: none;
  }
</style>
