import { describe, expect, it } from "vitest";
import { parseAccelerator, matchesAccelerator, formatShortcut, normaliseEventKey, isTypingTarget, installShortcuts } from "../lib/shortcuts";

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("parseAccelerator", () => {
  it("parses modifiers and keys", () => {
    expect(parseAccelerator("CmdOrCtrl+Shift+Z")).toEqual({ cmdOrCtrl: true, ctrl: false, meta: false, shift: true, alt: false, key: "z" });
    expect(parseAccelerator("Ctrl+Alt+Delete")).toMatchObject({ ctrl: true, alt: true, key: "Delete" });
    expect(parseAccelerator("Shift+F6")).toMatchObject({ shift: true, key: "F6" });
    expect(parseAccelerator("Escape")).toMatchObject({ key: "Escape" });
  });

  it("handles '+' and '=' as keys", () => {
    expect(parseAccelerator("CmdOrCtrl+=")?.key).toBe("=");
    expect(parseAccelerator("CmdOrCtrl++")?.key).toBe("+");
    expect(parseAccelerator("CmdOrCtrl+-")?.key).toBe("-");
  });

  it("returns null for empty / modifier-only strings", () => {
    expect(parseAccelerator("")).toBeNull();
    expect(parseAccelerator("Ctrl+")).toBeNull();
  });
});

describe("matchesAccelerator", () => {
  it("maps CmdOrCtrl per platform", () => {
    const acc = parseAccelerator("CmdOrCtrl+S")!;
    expect(matchesAccelerator(acc, ev("s", { ctrlKey: true }), false)).toBe(true);
    expect(matchesAccelerator(acc, ev("s", { metaKey: true }), false)).toBe(false);
    expect(matchesAccelerator(acc, ev("s", { metaKey: true }), true)).toBe(true);
    expect(matchesAccelerator(acc, ev("s", { ctrlKey: true }), true)).toBe(false);
  });

  it("requires exact modifier sets", () => {
    const acc = parseAccelerator("CmdOrCtrl+Z")!;
    expect(matchesAccelerator(acc, ev("z", { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(matchesAccelerator(parseAccelerator("CmdOrCtrl+Shift+Z")!, ev("Z", { ctrlKey: true, shiftKey: true, code: "KeyZ" }), false)).toBe(true);
  });

  it("accepts = for + (zoom in) and _ for -", () => {
    expect(matchesAccelerator(parseAccelerator("CmdOrCtrl+=")!, ev("+", { ctrlKey: true }), false)).toBe(true);
    expect(matchesAccelerator(parseAccelerator("CmdOrCtrl+-")!, ev("_", { ctrlKey: true }), false)).toBe(true);
  });

  it("uses the physical key code for letters so layouts don't matter", () => {
    expect(normaliseEventKey(ev("Ω", { altKey: true, code: "KeyZ" }))).toBe("z");
    expect(normaliseEventKey(ev("!", { shiftKey: true, code: "Digit1" }))).toBe("1");
    expect(normaliseEventKey(ev("ArrowUp"))).toBe("ArrowUp");
  });
});

describe("formatShortcut", () => {
  it("renders Windows and macOS styles", () => {
    expect(formatShortcut("CmdOrCtrl+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(formatShortcut("CmdOrCtrl+Shift+Z", true)).toBe("⇧⌘Z");
    expect(formatShortcut("Delete", false)).toBe("Del");
    expect(formatShortcut("Shift+g", false)).toBe("Shift+G");
    expect(formatShortcut(undefined, false)).toBe("");
  });
});

describe("isTypingTarget", () => {
  it("detects text inputs but not checkboxes", () => {
    const text = document.createElement("input");
    const check = document.createElement("input");
    check.type = "checkbox";
    const ta = document.createElement("textarea");
    const div = document.createElement("div");
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(check)).toBe(false);
    expect(isTypingTarget(ta)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("installShortcuts", () => {
  function setup() {
    const ran: string[] = [];
    const uninstall = installShortcuts({
      commands: () => [
        { shortcut: "CmdOrCtrl+E", run: () => void ran.push("merge") },
        { shortcut: "CmdOrCtrl+D", run: () => void ran.push("deselect") },
      ],
      toolKey: (e) => {
        if (e.key === "b") ran.push("tool:b");
        return e.key === "b";
      },
      toolEvent: () => false,
      modalOpen: () => false,
      escape: () => void ran.push("escape"),
    });
    return { ran, uninstall };
  }

  it("lets Ctrl chords through from a <select> / range slider but not plain keys", () => {
    const { ran, uninstall } = setup();
    const select = document.createElement("select");
    const range = document.createElement("input");
    range.type = "range";
    document.body.append(select, range);
    try {
      select.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", ctrlKey: true, bubbles: true }));
      range.dispatchEvent(new KeyboardEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true, bubbles: true }));
      // Plain letters navigate the <select>'s options: they must not switch tools.
      select.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }));
      expect(ran).toEqual(["merge", "deselect"]);
    } finally {
      uninstall();
      select.remove();
      range.remove();
    }
  });

  it("falls through a disabled command to an enabled one with the same accelerator", () => {
    const ran: string[] = [];
    const uninstall = installShortcuts({
      commands: () => [
        { shortcut: "CmdOrCtrl+Shift+G", enabled: () => false, run: () => void ran.push("ungroup") },
        { shortcut: "CmdOrCtrl+Shift+G", run: () => void ran.push("generate") },
      ],
      toolKey: () => {
        ran.push("tool");
        return true;
      },
      toolEvent: () => false,
      modalOpen: () => false,
      escape: () => {},
    });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "G", code: "KeyG", ctrlKey: true, shiftKey: true, bubbles: true }));
      expect(ran).toEqual(["generate"]);
    } finally {
      uninstall();
    }
  });

  it("still swallows chords inside a text field", () => {
    const { ran, uninstall } = setup();
    const text = document.createElement("input");
    document.body.append(text);
    try {
      text.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", ctrlKey: true, bubbles: true }));
      expect(ran).toEqual([]);
    } finally {
      uninstall();
      text.remove();
    }
  });
});
