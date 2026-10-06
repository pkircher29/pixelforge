/**
 * Tool store: active tool, per-tool options (persisted), foreground/background colours.
 *
 * Tools themselves are plain classes in `$lib/tools`; this store only holds the
 * reactive state they read through `ToolContext`.
 */
import type { RGBA } from "$lib/engine";

const LS_KEY = "pixelforge.tools.v1";

export type OptionValue = number | string | boolean;

interface Persisted {
  activeToolId: string;
  options: Record<string, Record<string, OptionValue>>;
  fg: RGBA;
  bg: RGBA;
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };

function load(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function isRgba(v: unknown): v is RGBA {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ["r", "g", "b", "a"].every((k) => typeof o[k] === "number");
}

export function rgbaToHex(c: RGBA): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hexToRgba(hex: string, a = 255): RGBA | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}

class ToolStore {
  activeToolId = $state("move");
  /** Temporarily overriding tool (Space -> hand, Alt with brush -> eyedropper). */
  tempToolId = $state<string | null>(null);
  options = $state<Record<string, Record<string, OptionValue>>>({});
  fg = $state<RGBA>({ ...BLACK });
  bg = $state<RGBA>({ ...WHITE });
  /** Status-bar hint set by the active tool ("Drag to paint. Shift for lines."). */
  hint = $state("");

  constructor() {
    const p = load();
    if (typeof p.activeToolId === "string") this.activeToolId = p.activeToolId;
    if (p.options && typeof p.options === "object") this.options = p.options;
    if (isRgba(p.fg)) this.fg = p.fg;
    if (isRgba(p.bg)) this.bg = p.bg;
  }

  /** The tool id pointer events go to right now. */
  get effectiveToolId(): string {
    return this.tempToolId ?? this.activeToolId;
  }

  persist(): void {
    try {
      const data: Persisted = {
        activeToolId: this.activeToolId,
        options: $state.snapshot(this.options),
        fg: $state.snapshot(this.fg),
        bg: $state.snapshot(this.bg),
      };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  setActive(id: string): void {
    this.activeToolId = id;
    this.tempToolId = null;
    this.persist();
  }

  option<T extends OptionValue>(toolId: string, key: string, fallback: T): T {
    const v = this.options[toolId]?.[key];
    return (v === undefined ? fallback : (v as T)) as T;
  }

  setOption(toolId: string, key: string, value: OptionValue): void {
    const bag = this.options[toolId] ?? (this.options[toolId] = {});
    bag[key] = value;
    this.persist();
  }

  resetOptions(toolId: string): void {
    delete this.options[toolId];
    this.persist();
  }

  setFg(c: RGBA): void {
    this.fg = { ...c, a: 255 };
    this.persist();
  }

  setBg(c: RGBA): void {
    this.bg = { ...c, a: 255 };
    this.persist();
  }

  /** X: swap foreground / background. */
  swap(): void {
    const f = this.fg;
    this.fg = this.bg;
    this.bg = f;
    this.persist();
  }

  /** D: reset to black / white. */
  resetColors(): void {
    this.fg = { ...BLACK };
    this.bg = { ...WHITE };
    this.persist();
  }
}

export const toolStore = new ToolStore();
