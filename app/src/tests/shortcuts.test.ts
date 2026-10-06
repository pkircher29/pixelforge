import { describe, expect, it } from "vitest";
import { parseAccelerator, matchesAccelerator, formatShortcut, normaliseEventKey, isTypingTarget } from "../lib/shortcuts";

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
