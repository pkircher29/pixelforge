/**
 * Shared binding for the Character / Paragraph panels: the live type session when
 * editing, else the active text layer (edits push `SetTextLayerCommand`), else the Type
 * tool's options (defaults for new text).
 */
import { SetTextLayerCommand, textSpec, type TextSpec } from "$lib/engine";
import { docStore } from "$lib/stores/doc.svelte";
import { toolStore } from "$lib/stores/tool.svelte";
import { typeSession } from "$lib/tools/type-session.svelte";

export type TypeTarget = { kind: "session" | "layer" | "defaults"; spec: TextSpec; layerId: string | null };

export function currentTypeTarget(): TypeTarget {
  void typeSession.version;
  if (typeSession.active) return { kind: "session", spec: typeSession.spec, layerId: typeSession.layerId };
  const e = docStore.active;
  if (e) {
    void e.version;
    const l = docStore.activeLayer;
    if (l && l.kind === "text") return { kind: "layer", spec: l.text, layerId: l.id };
  }
  const o = <T extends string | number | boolean>(k: string, d: T): T => toolStore.option("text", k, d);
  const style = o<string>("style", "regular");
  return {
    kind: "defaults",
    layerId: null,
    spec: textSpec("", 0, 0, {
      font: o<string>("family", "Segoe UI"),
      size: o<number>("size", 48),
      bold: style === "bold" || style === "boldItalic",
      italic: style === "italic" || style === "boldItalic",
      align: o<string>("align", "left") as TextSpec["align"],
      color: { ...toolStore.fg },
      leading: (o<number>("leading", 0) || null) as number | null,
      tracking: o<number>("tracking", 0),
    }),
  };
}

/** Apply a spec patch to the current target. Extra fields (allCaps, underline, indents) ride along in TextSpec as unknown keys for forward compat. */
export function applyTypePatch(patch: Partial<TextSpec>): void {
  const t = currentTypeTarget();
  if (t.kind === "session") {
    typeSession.update(patch);
    syncToolOptions(patch);
    return;
  }
  if (t.kind === "layer" && t.layerId) {
    docStore.exec(new SetTextLayerCommand(t.layerId, patch, "Character"));
    return;
  }
  syncToolOptions(patch);
}

function syncToolOptions(patch: Partial<TextSpec>): void {
  for (const id of ["text", "type-v", "type-mask-h", "type-mask-v"]) {
    if (patch.font !== undefined) toolStore.setOption(id, "family", patch.font);
    if (patch.size !== undefined) toolStore.setOption(id, "size", patch.size);
    if (patch.align !== undefined) toolStore.setOption(id, "align", patch.align);
    if (patch.bold !== undefined || patch.italic !== undefined) {
      const cur = currentTypeTarget().spec;
      const b = patch.bold ?? cur.bold;
      const i = patch.italic ?? cur.italic;
      toolStore.setOption(id, "style", b && i ? "boldItalic" : b ? "bold" : i ? "italic" : "regular");
    }
    if (patch.tracking !== undefined) toolStore.setOption(id, "tracking", patch.tracking);
    if (patch.leading !== undefined) toolStore.setOption(id, "leading", patch.leading ?? 0);
  }
  if (patch.color) toolStore.setFg(patch.color);
}
