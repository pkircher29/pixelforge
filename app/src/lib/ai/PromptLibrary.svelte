<script lang="ts">
  import { settings } from "$lib/stores/settings.svelte";
  import { aiUi } from "./ui.svelte";
  import { readPrompts, savePrompt, type SavedPrompt } from "./prompt-library";
  let search = $state("");
  let name = $state("");
  let selected = $state("");
  let busy = $state(false);
  let message = $state("");
  let failed = $state(false);
  let deleted = $state<SavedPrompt | null>(null);
  const items = $derived(readPrompts(settings.value.promptLibrary));
  const visible = $derived(items.filter(p => `${p.name} ${p.prompt} ${p.negativePrompt}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const current = $derived(items.find(p => p.id === selected));
  const unavailable = $derived(busy || !settings.loaded || Boolean(settings.loadError));

  async function write(next: SavedPrompt[], success: string): Promise<boolean> {
    busy = true; failed = false; message = "";
    const previous = settings.value.promptLibrary;
    try {
      await settings.set({ promptLibrary: next }, { throwOnError: true });
      message = success;
      return true;
    } catch {
      settings.value = { ...settings.value, promptLibrary: previous };
      failed = true; message = "Could not save the prompt library. Your previous library is unchanged; try again.";
      return false;
    } finally { busy = false; }
  }
  async function save(update: boolean): Promise<void> {
    try {
      const entry = { id: update && current ? current.id : crypto.randomUUID(), name, prompt: aiUi.prompt, negativePrompt: aiUi.showNegative ? aiUi.negativePrompt : "" };
      const next = savePrompt(items, entry);
      if (await write(next, update ? "Saved prompt updated." : "Prompt saved.")) selected = entry.id;
    } catch (e) { failed = true; message = e instanceof Error ? e.message : String(e); }
  }
  function use(): void {
    if (!current) return;
    aiUi.prompt = current.prompt;
    aiUi.negativePrompt = current.negativePrompt;
    aiUi.showNegative = Boolean(current.negativePrompt);
    name = current.name;
    failed = false; message = "Prompt loaded. Review it before running.";
  }
  async function remove(): Promise<void> {
    if (!current) return;
    const old = current;
    if (await write(items.filter(p => p.id !== old.id), "Prompt deleted.")) { deleted = old; selected = ""; }
  }
  async function undoDelete(): Promise<void> {
    if (!deleted) return;
    try { if (await write(savePrompt(items, deleted), "Deleted prompt restored.")) { selected = deleted.id; deleted = null; } }
    catch (e) { failed = true; message = e instanceof Error ? e.message : String(e); }
  }
</script>

<details class="library">
  <summary>Prompt library ({items.length})</summary>
  <div class="body" role="group" aria-label="Prompt library">
    <input class="input" aria-label="Search saved prompts" placeholder="Search saved prompts…" bind:value={search} />
    <select class="input" size="4" aria-label="Saved prompts" bind:value={selected} onchange={(e) => { const p = items.find(p => p.id === e.currentTarget.value); if (p) name = p.name; }}>
      {#each visible as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    {#if !visible.length}<span class="hint">{items.length ? "No matching prompts." : "Save your first prompt below."}</span>{/if}
    <div class="actions">
      <button class="btn" type="button" disabled={unavailable || !current} onclick={use}>Use prompt</button>
      <button class="btn" type="button" disabled={unavailable || !current} onclick={() => void remove()}>Delete</button>
      {#if deleted}<button class="btn" type="button" disabled={unavailable} onclick={() => void undoDelete()}>Undo delete</button>{/if}
    </div>
    <input class="input" aria-label="Saved prompt name" placeholder="Name for this prompt" maxlength="80" bind:value={name} />
    <div class="actions">
      <button class="btn" type="button" disabled={unavailable || !name.trim() || !aiUi.prompt.trim()} onclick={() => void save(false)}>Save current</button>
      <button class="btn" type="button" disabled={unavailable || !current || !name.trim() || !aiUi.prompt.trim()} onclick={() => void save(true)}>Update selected</button>
    </div>
    <span class="hint">Saves the prompt and enabled Avoid text on this device.</span>
    {#if settings.loadError}<p class="error" role="status">{settings.loadError}</p>{/if}
    {#if message}<p class:error={failed} role="status">{message}</p>{/if}
  </div>
</details>

<style>
  .library { font-size: 11px; }
  summary { cursor: pointer; padding: 5px 0; }
  .body { display: grid; gap: 6px; }
  .input { width: 100%; box-sizing: border-box; min-width: 0; }
  select { min-height: 68px; }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; }
  .hint { color: var(--ps-text-dim); }
  p { margin: 0; overflow-wrap: anywhere; }
  .error { color: #ff9a9a; }
</style>
