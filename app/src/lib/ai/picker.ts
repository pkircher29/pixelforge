/**
 * Pure layout rules for `ProviderPicker.svelte`: which providers get a chip and which
 * go to the overflow dropdown. Tested in `tests/ai/picker.test.ts`.
 */

import { authLabel, canGenerate, onSubscription, type ProviderId, type ProviderInfo } from "./types";

export interface PickerLayout {
  /** Providers rendered as chips, in order. */
  chips: ProviderInfo[];
  /** Providers only reachable through the dropdown. */
  overflow: ProviderInfo[];
  /** The dropdown is needed. */
  hasOverflow: boolean;
}

/** Chips shown before the row collapses into a dropdown (PLAN-v2 §1b: "> 4"). */
export const DEFAULT_MAX_CHIPS = 4;

/**
 * Keep the first `maxChips` generating providers as chips; the selected one is always a
 * chip (it replaces the last slot when it would otherwise overflow). Prompt-assist-only
 * providers (Ollama) never get a chip.
 */
export function pickerLayout(providers: readonly ProviderInfo[], selected: ProviderId | null, maxChips = DEFAULT_MAX_CHIPS): PickerLayout {
  const gens = providers.filter(canGenerate);
  if (gens.length <= maxChips) return { chips: gens, overflow: [], hasOverflow: false };
  const chips = gens.slice(0, maxChips);
  const sel = selected ? gens.find((p) => p.id === selected) : undefined;
  if (sel && !chips.includes(sel)) chips[maxChips - 1] = sel;
  const overflow = gens.filter((p) => !chips.includes(p));
  return { chips, overflow, hasOverflow: true };
}

/** Glyph prefix for a chip: 🖥 for local servers, nothing for hosted. */
export function chipGlyph(p: ProviderInfo): string {
  return p.local ? "🖥 " : "";
}

/** Tooltip for a chip. */
export function chipTitle(p: ProviderInfo): string {
  const where = p.local ? "local, no cost" : p.kind === "builtin" ? p.vendor : `${p.vendor}, hosted`;
  if (onSubscription(p)) return p.account ? `${authLabel(p)}: signed in${p.account.email ? ` as ${p.account.email}` : ""}` : `${authLabel(p)}: not signed in, click to sign in`;
  if (p.kind !== "builtin" && !p.hasKey && !p.keyOptional) return `${p.name} (${where}): no token yet, click to add one`;
  if (p.kind === "builtin" && !p.hasKey) return `${p.name}: no key yet, click to add one`;
  return `${p.name} (${where})${p.hasKey ? ": key saved" : ""}`;
}
