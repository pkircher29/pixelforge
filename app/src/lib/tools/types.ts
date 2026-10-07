/**
 * Tool contract. A tool is a plain class; the canvas view feeds it pointer events in
 * document space and gives it a `ToolContext` to reach the active document, history,
 * viewport, colours and options. Tools keep their own transient drag state.
 */
import type { Component } from "svelte";
import type { Command, Document, History, ICompositor, LayerId, RGBA, Rect, Viewport } from "$lib/engine";
import type { OpenDoc } from "$lib/stores/doc.svelte";
import type { OptionValue } from "$lib/stores/tool.svelte";

export type IconComponent = Component<{ size?: number | string; strokeWidth?: number | string; class?: string }>;

export interface ToolEvent {
  /** Document-space position (fractional pixels). */
  x: number;
  y: number;
  /** CSS px relative to the canvas element. */
  screenX: number;
  screenY: number;
  /** 0..1; 0.5 when the device has no pressure. */
  pressure: number;
  pointerType: string;
  button: number;
  buttons: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type ToolOption =
  | {
      kind: "number";
      key: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      default: number;
      unit?: string;
      /** Render a slider next to the field (default true). */
      slider?: boolean;
      /** Logarithmic slider (brush sizes). */
      log?: boolean;
    }
  | { kind: "select"; key: string; label: string; choices: { value: string; label: string }[]; default: string }
  | { kind: "toggle"; key: string; label: string; default: boolean }
  | { kind: "text"; key: string; label: string; default: string; placeholder?: string; width?: number }
  | { kind: "color"; key: "fg" | "bg"; label: string }
  | { kind: "button"; key: string; label: string; primary?: boolean; action: (ctx: ToolContext) => void }
  | { kind: "separator"; key: string }
  /**
   * Custom options-bar control rendered by `lib/tools/ui/CustomOption.svelte` (tools-v2):
   * `renderer` picks the component ("brush-picker", "gradient-picker", "shape-picker",
   * "font-picker", "fill-picker", "pattern-picker", "measure-readout", "icon-select",
   * "align-buttons"). `default` is the stored option value (JSON string for structured
   * values); `props` are passed through to the renderer.
   */
  | { kind: "custom"; key: string; renderer: string; label?: string; default?: OptionValue; props?: Record<string, unknown> };

export interface ToolContext {
  readonly entry: OpenDoc;
  readonly doc: Document;
  readonly history: History;
  readonly viewport: Viewport;
  readonly compositor: ICompositor | null;
  /** Canvas size in CSS px. */
  readonly viewW: number;
  readonly viewH: number;
  /** Read a tool option (falls back to the schema default). */
  opt<T extends OptionValue>(key: string): T;
  setOpt(key: string, value: OptionValue): void;
  fg(): RGBA;
  bg(): RGBA;
  setFg(c: RGBA): void;
  setBg(c: RGBA): void;
  /** Push an undoable command on the active doc. */
  exec(cmd: Command, opts?: { alreadyApplied?: boolean; noMerge?: boolean }): void;
  /** Non-undoable change; `dirty` marks layer pixels for re-upload. */
  touch(dirty?: { layerId: LayerId; rect?: Rect }): void;
  /** Ask the overlay canvas to redraw (marquee preview, crop handles...). */
  invalidateOverlay(): void;
  /** Change the CSS cursor for the canvas (`"crosshair"`, `"grab"`, a `url(...)`). */
  setCursor(cursor: string): void;
  /** Status-bar hint. */
  hint(text: string): void;
  /** Non-fatal feedback. */
  notify(kind: "info" | "error" | "success", message: string): void;
  /** Switch tools (e.g. after Crop commits). */
  selectTool(id: string): void;
  setActiveLayer(id: LayerId): void;
  /** Open the inline text editor (Text tool). */
  beginTextEdit(docX: number, docY: number): void;
}

/** A tool preset shown in the options bar's preset picker (Wave 6 fills these). */
export interface ToolPreset {
  id: string;
  name: string;
  options: Record<string, OptionValue>;
}

export interface Tool {
  readonly id: string;
  readonly name: string;
  readonly icon: IconComponent;
  /** Single key ("v") or with Shift ("Shift+g"). */
  readonly shortcut: string;
  /**
   * Toolbar fly-out group id (PLAN-v2 §2 slot: "move", "marquee", "lasso", "quickselect",
   * "crop", "eyedropper", "healing", "brush", "stamp", "history", "eraser", "gradient",
   * "blur", "dodge", "pen", "type", "pathselect", "shape", "hand", "zoom"). Tools without a
   * group get a slot of their own after the known groups.
   */
  readonly group?: string;
  /** Position inside the fly-out (0 = top). Defaults to the §2 member order. */
  readonly groupOrder?: number;
  /** Name shown in the fly-out / tooltip ("Horizontal Type Tool"); defaults to `${name} Tool`. */
  readonly flyoutLabel?: string;
  /** Glyph name in `lib/ui/icons` when it differs from `id` (e.g. "text" → "type-h"). */
  readonly glyph?: string;
  /** Options-bar presets (Wave 6). */
  readonly presets?: readonly ToolPreset[];
  /** Default CSS cursor while hovering the canvas. */
  readonly cursor: string;
  readonly options: readonly ToolOption[];
  /** One-line status hint shown when the tool is active. */
  readonly hint?: string;
  onPointerDown(e: ToolEvent, ctx: ToolContext): void;
  onPointerMove(e: ToolEvent, ctx: ToolContext): void;
  onPointerUp(e: ToolEvent, ctx: ToolContext): void;
  /** Keyboard while the tool is active; return true if consumed. */
  onKey?(e: KeyboardEvent, ctx: ToolContext, phase: "down" | "up"): boolean;
  /** Esc / tool switch: drop any in-progress operation. */
  cancel?(ctx: ToolContext): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  /** Draw on the 2D overlay (CSS px; use `ctx.viewport.docToScreen`). */
  drawOverlay?(g: CanvasRenderingContext2D, ctx: ToolContext): void;
}

/** Common modifier→selection-mode mapping (Photoshop): Shift add, Alt subtract, both intersect. */
export type SelectionMode = "new" | "add" | "subtract" | "intersect";
