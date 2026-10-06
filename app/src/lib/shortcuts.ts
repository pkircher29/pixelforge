/**
 * Keyboard shortcuts: Electron-style accelerator parsing, event matching, display
 * formatting and the single `window` keydown dispatcher.
 *
 * Resolution order on keydown: a modal/dialog or text field swallows everything except
 * Esc; then registry commands by accelerator; then tool single-key shortcuts; then the
 * active tool's `onKey` (arrows, Enter, Esc, Space).
 */

export interface Accelerator {
  /** `CmdOrCtrl` resolved per platform at match time. */
  cmdOrCtrl: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** Normalised key: single chars lower-cased, named keys as `KeyboardEvent.key` ("Escape", "ArrowUp", "F5", "Tab", "+", "-"). */
  key: string;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: " ",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  plus: "+",
  minus: "-",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  "=": "=",
};

/** Parse `"CmdOrCtrl+Shift+Z"`, `"Shift+F6"`, `"Delete"`, `"Ctrl+="`. Returns null for empty. */
export function parseAccelerator(acc: string): Accelerator | null {
  const trimmed = acc.trim();
  if (!trimmed) return null;
  const out: Accelerator = { cmdOrCtrl: false, ctrl: false, meta: false, shift: false, alt: false, key: "" };
  // Split on '+' whenever a token is pending, so "Ctrl++" yields ["Ctrl", "+"] and
  // "Ctrl+" yields ["Ctrl"] (no key → null).
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "+" && cur.length > 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    const l = p.toLowerCase();
    switch (l) {
      case "cmdorctrl":
      case "commandorcontrol":
      case "mod":
        out.cmdOrCtrl = true;
        break;
      case "ctrl":
      case "control":
        out.ctrl = true;
        break;
      case "cmd":
      case "command":
      case "meta":
      case "super":
        out.meta = true;
        break;
      case "shift":
        out.shift = true;
        break;
      case "alt":
      case "option":
        out.alt = true;
        break;
      default: {
        const alias = KEY_ALIASES[l];
        if (alias) out.key = alias;
        else if (/^f\d{1,2}$/.test(l)) out.key = l.toUpperCase();
        else if (p.length === 1) out.key = l;
        else out.key = p;
      }
    }
  }
  if (!out.key) return null;
  return out;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Normalise a KeyboardEvent key the same way `parseAccelerator` does. */
export function normaliseEventKey(e: KeyLike): string {
  const k = e.key;
  if (k.length === 1) {
    // With Shift/Alt the produced character may differ ("+" vs "="): prefer the physical
    // digit/letter from `code` so "Ctrl+Shift+Z" works on every layout.
    if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    if (e.code && /^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (k === " ") return " ";
    return k.toLowerCase();
  }
  if (k === "Esc") return "Escape";
  return k;
}

/** Does the event match the accelerator? `isMac` maps CmdOrCtrl to meta. */
export function matchesAccelerator(acc: Accelerator, e: KeyLike, isMac: boolean): boolean {
  const wantCtrl = acc.ctrl || (acc.cmdOrCtrl && !isMac);
  const wantMeta = acc.meta || (acc.cmdOrCtrl && isMac);
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.metaKey !== wantMeta) return false;
  if (e.shiftKey !== acc.shift) return false;
  if (e.altKey !== acc.alt) return false;
  const key = normaliseEventKey(e);
  if (key === acc.key) return true;
  // "=" and "+" share a physical key; let "Ctrl+=" and "Ctrl++" both hit zoom in.
  if ((acc.key === "=" || acc.key === "+") && (key === "=" || key === "+")) return true;
  if (acc.key === "-" && (key === "-" || key === "_")) return true;
  return false;
}

const MAC_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" } as const;
const KEY_LABELS: Record<string, string> = {
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
  Backspace: "⌫",
  Delete: "Del",
  Enter: "Enter",
  Tab: "Tab",
};

/** Human label: "Ctrl+Shift+Z" on Windows/Linux, "⇧⌘Z" on macOS. */
export function formatShortcut(acc: string | Accelerator | undefined, isMac: boolean): string {
  if (!acc) return "";
  const a = typeof acc === "string" ? parseAccelerator(acc) : acc;
  if (!a) return "";
  const keyLabel = KEY_LABELS[a.key] ?? (a.key.length === 1 ? a.key.toUpperCase() : a.key);
  const ctrl = a.ctrl || (a.cmdOrCtrl && !isMac);
  const meta = a.meta || (a.cmdOrCtrl && isMac);
  if (isMac) {
    return (
      (ctrl ? MAC_SYMBOLS.ctrl : "") +
      (a.alt ? MAC_SYMBOLS.alt : "") +
      (a.shift ? MAC_SYMBOLS.shift : "") +
      (meta ? MAC_SYMBOLS.meta : "") +
      keyLabel
    );
  }
  const parts: string[] = [];
  if (ctrl) parts.push("Ctrl");
  if (meta) parts.push("Win");
  if (a.alt) parts.push("Alt");
  if (a.shift) parts.push("Shift");
  parts.push(keyLabel);
  return parts.join("+");
}

/** True when keyboard focus is in something that consumes typing. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (t as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "range", "color", "submit"].includes(type);
  }
  return false;
}

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent);

export interface ShortcutHandlers {
  /** Registry commands: `[accelerator, run]` pairs, resolved lazily each keydown. */
  commands: () => Iterable<{ shortcut?: string; enabled?: () => boolean; run: () => void | Promise<void> }>;
  /** Tool single keys ("v", "Shift+g"); return true if handled. */
  toolKey: (e: KeyboardEvent) => boolean;
  /** Forward to the active tool; return true if handled. */
  toolEvent: (e: KeyboardEvent, phase: "down" | "up") => boolean;
  /** Something modal is open (dialogs handle their own keys). */
  modalOpen: () => boolean;
  /** Esc with nothing else to do (cancel tool op, close palette). */
  escape: () => void;
}

/** Install the global dispatcher; returns an uninstall function. */
export function installShortcuts(h: ShortcutHandlers): () => void {
  const cache = new Map<string, Accelerator | null>();
  const parsed = (s: string): Accelerator | null => {
    let a = cache.get(s);
    if (a === undefined) {
      a = parseAccelerator(s);
      cache.set(s, a);
    }
    return a;
  };

  const onDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    if (h.modalOpen()) return;
    // A <select> or range slider only "types" plain keys (arrow / letter navigation):
    // Ctrl/Cmd chords must still reach the app, otherwise picking a blend mode leaves
    // every shortcut dead (and Ctrl+G falls through to the webview's Find bar).
    const target = e.target;
    const widget = target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type === "range");
    const typing = isTypingTarget(target) && !(widget && (e.ctrlKey || e.metaKey));
    if (typing) {
      if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
      }
      return;
    }
    // Commands first (they may include Ctrl+Z etc. that the webview would otherwise eat).
    // A disabled match swallows the key but lets a later enabled command with the same
    // accelerator run (modules register in isolation; collisions degrade gracefully).
    let matched = false;
    for (const c of h.commands()) {
      if (!c.shortcut) continue;
      const a = parsed(c.shortcut);
      if (!a || !matchesAccelerator(a, e, IS_MAC)) continue;
      e.preventDefault();
      matched = true;
      if (c.enabled && !c.enabled()) continue;
      void c.run();
      return;
    }
    if (matched) return;
    if (h.toolEvent(e, "down")) {
      e.preventDefault();
      return;
    }
    if (h.toolKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") h.escape();
    // Block the webview's own accelerators (Ctrl+P print, Ctrl+F find, F5 reload in prod...).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[a-z]$/i.test(e.key) && !import.meta.env.DEV) e.preventDefault();
  };
  const onUp = (e: KeyboardEvent): void => {
    if (h.modalOpen() || isTypingTarget(e.target)) return;
    if (h.toolEvent(e, "up")) e.preventDefault();
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  return () => {
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
  };
}
