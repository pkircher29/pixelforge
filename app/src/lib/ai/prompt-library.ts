export interface SavedPrompt {
  id: string;
  name: string;
  prompt: string;
  negativePrompt: string;
}

export const MAX_SAVED_PROMPTS = 200;

/** Treat persisted settings as untrusted data; retain only bounded prompt fields. */
export function readPrompts(value: unknown): SavedPrompt[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SavedPrompt[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id || p.id.length > 100 || seen.has(p.id)) continue;
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80) continue;
    if (typeof p.prompt !== "string" || !p.prompt.trim() || p.prompt.length > 20000) continue;
    if (typeof p.negativePrompt !== "string" || p.negativePrompt.length > 20000) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name.trim(), prompt: p.prompt, negativePrompt: p.negativePrompt });
    if (out.length === MAX_SAVED_PROMPTS) break;
  }
  return out;
}

export function savePrompt(items: SavedPrompt[], entry: SavedPrompt): SavedPrompt[] {
  if (readPrompts([entry]).length !== 1) throw new Error("Enter a name (up to 80 characters) and a prompt (up to 20,000 characters).");
  if (items.some(p => p.id !== entry.id && p.name.toLocaleLowerCase() === entry.name.trim().toLocaleLowerCase())) throw new Error("That name is already used. Choose another name or update the saved prompt.");
  if (!items.some(p => p.id === entry.id) && items.length >= MAX_SAVED_PROMPTS) throw new Error("The library holds 200 prompts. Delete one before adding another.");
  return [...items.filter(p => p.id !== entry.id), { ...entry, name: entry.name.trim() }];
}
