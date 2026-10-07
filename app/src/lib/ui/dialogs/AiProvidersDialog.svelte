<script lang="ts">
  /**
   * Settings > AI Providers: left list (built-ins with key status, custom entries, "+ Add"
   * menu), right form per selection. Replaces the v0.1 ApiKeysDialog. Mounted on
   * `document.body` by `$lib/ai/dialogs`. Flat, dense markup (11px / 22px rows) on the
   * app.css tokens so the Wave 6 Photoshop restyle only has to remap colours.
   */
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { invoke } from "@tauri-apps/api/core";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { deleteKey, getKeyStatus, hasTauri, hubSearch, setKey, testKey } from "$lib/ai/client";
  import { toFriendlyError } from "$lib/ai/errors";
  import { newCustomProvider, providersStore, slugify } from "$lib/ai/providers.svelte";
  import { oauthStore } from "$lib/ai/oauth.svelte";
  import { LIMITATIONS_URL, XAI_RESEARCH_URL, authItems, authModeOf, subscriptionView } from "$lib/ai/auth-ui";
  import Segmented from "$lib/ui/controls/Segmented.svelte";
  import {
    type AuthMode,
    PROVIDER_CONSOLE_URL,
    PROVIDER_IDS,
    PROVIDER_LABEL,
    PROVIDER_VENDOR,
    customIdOf,
    isCustomProviderId,
    type BuiltinProviderId,
    type Capabilities,
    type CustomKind,
    type CustomProvider,
    type HubModel,
    type ProbeResult,
    type ProviderId,
  } from "$lib/ai/types";

  interface Props {
    onclose: () => void;
    initialSelect?: ProviderId;
    initialAddKind?: CustomKind;
  }
  const { onclose, initialSelect, initialAddKind }: Props = $props();

  type Selection = { kind: "builtin"; id: BuiltinProviderId } | { kind: "custom"; id: string } | { kind: "new"; draft: CustomProvider } | null;

  let selection = $state<Selection>(null);
  let keyStatus = $state<Partial<Record<ProviderId, boolean>>>({});
  let backend = $state<"keyring" | "file" | null>(null);
  let addOpen = $state(false);
  let panel = $state<HTMLDivElement | null>(null);

  // Built-in form
  let keyValue = $state("");
  let showKey = $state(false);
  let busy = $state<"" | "test" | "save" | "delete" | "probe" | "models" | "search" | "remove">("");
  let result = $state<{ ok: boolean; text: string } | null>(null);

  // Custom form
  let draft = $state<CustomProvider | null>(null);
  let draftIsNew = $state(false);
  let draftAuth = $state("");
  let clearAuth = $state(false);
  let idTouched = $state(false);
  let probe = $state<ProbeResult | null>(null);
  let modelOptions = $state<string[]>([]);
  let extraText = $state("");
  let extraError = $state<string | null>(null);
  let showAdvanced = $state(false);
  let hubQuery = $state("");
  let hubPipeline = $state<"text-to-image" | "image-to-image">("text-to-image");
  let hubHits = $state<HubModel[]>([]);
  let workflowText = $state("");

  const kinds = $derived(providersStore.kinds);
  const customs = $derived(providersStore.custom);
  const kindInfo = $derived(draft ? providersStore.kindInfo(draft.kind) : null);
  const isSd = $derived(draft?.kind === "comfy_ui" || draft?.kind === "a1111");
  const isLocalKind = $derived(draft ? ["comfy_ui", "a1111", "ollama", "openai_compat"].includes(draft.kind) : false);

  function num(key: string): number | "" {
    const v = draft?.extra[key];
    return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : "";
  }
  function str(key: string): string {
    const v = draft?.extra[key];
    return typeof v === "string" ? v : "";
  }
  function setExtra(key: string, value: unknown): void {
    if (!draft) return;
    const extra = { ...draft.extra };
    if (value === "" || value === null || value === undefined) delete extra[key];
    else extra[key] = value;
    draft.extra = extra;
    extraText = JSON.stringify(extra, null, 2);
  }
  function setExtraNum(key: string, e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).value.trim();
    setExtra(key, raw === "" ? "" : Number(raw));
  }
  function setExtraStr(key: string, e: Event): void {
    setExtra(key, (e.currentTarget as HTMLInputElement).value);
  }
  function onExtraText(): void {
    if (!draft) return;
    try {
      const v = JSON.parse(extraText || "{}") as unknown;
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("extra must be a JSON object");
      draft.extra = v as Record<string, unknown>;
      extraError = null;
    } catch (e) {
      extraError = e instanceof Error ? e.message : String(e);
    }
  }
  function onWorkflowText(): void {
    if (!draft) return;
    const t = workflowText.trim();
    if (!t) {
      setExtra("workflow", "");
      return;
    }
    try {
      setExtra("workflow", JSON.parse(t) as unknown);
      extraError = null;
    } catch (e) {
      extraError = `Workflow JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  async function loadTemplate(name: "txt2img" | "img2img" | "inpaint"): Promise<void> {
    if (!hasTauri()) {
      workflowText = `{ "note": "templates are bundled with the app; placeholders: {{prompt}} {{negative}} {{image}} {{mask}} {{width}} {{height}} {{seed}} {{steps}} {{cfg}} {{checkpoint}} {{denoise}} {{sampler}} {{scheduler}} {{batch}}" }`;
      return;
    }
    try {
      const t = await invoke<Record<string, string>>("ai_comfy_templates");
      workflowText = t[name] ?? "";
      onWorkflowText();
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    }
  }

  function selectBuiltin(id: BuiltinProviderId): void {
    selection = { kind: "builtin", id };
    keyValue = "";
    showKey = false;
    result = null;
    draft = null;
    xaiClientId = "";
    if (id !== "gemini") {
      void oauthStore.ensureListening();
      void oauthStore.refresh(id);
    }
  }

  // ---- subscription sign-in
  let xaiClientId = $state("");
  let copied = $state(false);
  async function setMode(id: BuiltinProviderId, mode: AuthMode): Promise<void> {
    result = null;
    await oauthStore.configure(id, { mode });
  }
  async function liveCheck(id: BuiltinProviderId): Promise<void> {
    await oauthStore.checkImages(id, true);
  }
  async function copy(text: string): Promise<void> {
    try {
      if (hasTauri()) await writeText(text);
      else await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
  async function saveClientId(): Promise<void> {
    if (!xaiClientId.trim()) return;
    await oauthStore.configure("x_ai", { xaiClientId: xaiClientId.trim() });
    xaiClientId = "";
  }
  async function clearClientId(): Promise<void> {
    await oauthStore.configure("x_ai", { xaiClientId: "" });
  }
  function selectCustom(id: string): void {
    const c = customs.find((x) => x.id === id);
    if (!c) return;
    selection = { kind: "custom", id };
    loadDraft({ ...c, capabilities: { ...c.capabilities }, extra: { ...c.extra } }, false);
  }
  function startAdd(kind: CustomKind): void {
    addOpen = false;
    const d = newCustomProvider(kind, kinds);
    d.id = slugify(d.name, customs.map((c) => c.id));
    selection = { kind: "new", draft: d };
    loadDraft(d, true);
  }
  function loadDraft(d: CustomProvider, isNew: boolean): void {
    draft = d;
    draftIsNew = isNew;
    draftAuth = "";
    clearAuth = false;
    idTouched = !isNew;
    probe = providersStore.probes[d.id] ?? null;
    const cached = Array.isArray(d.extra.models) ? (d.extra.models as unknown[]).filter((m): m is string => typeof m === "string") : [];
    modelOptions = cached.length ? cached : (probe?.models ?? []);
    extraText = JSON.stringify(d.extra, null, 2);
    extraError = null;
    result = null;
    hubHits = [];
    hubQuery = "";
    const wf = d.extra.workflow;
    workflowText = typeof wf === "string" ? wf : wf && typeof wf === "object" ? JSON.stringify(wf, null, 2) : "";
    showAdvanced = false;
  }
  function onNameInput(): void {
    if (draft && draftIsNew && !idTouched) draft.id = slugify(draft.name, customs.map((c) => c.id));
  }

  async function refresh(): Promise<void> {
    if (!hasTauri()) return;
    try {
      const status = await getKeyStatus();
      keyStatus = status;
      await providersStore.refresh();
      backend = providersStore.all[0]?.keyBackend ?? null;
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).title };
    }
  }

  onMount(() => {
    void refresh().then(() => {
      if (initialAddKind) startAdd(initialAddKind);
      else if (initialSelect && isCustomProviderId(initialSelect)) selectCustom(customIdOf(initialSelect) ?? "");
      else if (initialSelect) selectBuiltin(initialSelect as BuiltinProviderId);
      else selectBuiltin("open_ai");
    });
    panel?.querySelector<HTMLElement>("input, button")?.focus();
  });

  // ---- built-in actions
  async function saveBuiltin(id: BuiltinProviderId): Promise<void> {
    busy = "save";
    result = null;
    try {
      await setKey(id, keyValue);
      keyValue = "";
      keyStatus = { ...keyStatus, [id]: true };
      result = { ok: true, text: "Saved. Test it to be sure." };
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      busy = "";
    }
  }
  async function testBuiltin(id: BuiltinProviderId): Promise<void> {
    busy = "test";
    result = null;
    try {
      if (keyValue.trim()) {
        await setKey(id, keyValue);
        keyValue = "";
        keyStatus = { ...keyStatus, [id]: true };
      }
      await testKey(id);
      result = { ok: true, text: `${PROVIDER_VENDOR[id]} accepted the key.` };
    } catch (e) {
      const f = toFriendlyError(e);
      result = { ok: false, text: f.code === "ai_auth" ? `${PROVIDER_VENDOR[id]} rejected the key. ${f.detail}` : `${f.title} ${f.detail}` };
    } finally {
      busy = "";
    }
  }
  async function deleteBuiltin(id: BuiltinProviderId): Promise<void> {
    busy = "delete";
    result = null;
    try {
      await deleteKey(id);
      keyStatus = { ...keyStatus, [id]: false };
      keyValue = "";
      result = { ok: true, text: "Key removed." };
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      busy = "";
    }
  }

  // ---- custom actions
  function applyProbe(r: ProbeResult, fetchedModels: boolean): void {
    probe = r;
    if (r.models.length) {
      modelOptions = r.models;
      if (draft) {
        setExtra("models", r.models);
        if (!draft.model && r.models[0]) draft.model = r.models[0];
      }
    }
    if (draft && r.detectedCaps && draft.kind !== "openai_compat") {
      // Keep the user's edits for sizes; adopt what the probe could tell.
      draft.capabilities = { ...draft.capabilities, generate: r.detectedCaps.generate, instructEdit: r.detectedCaps.instructEdit, maskEdit: r.detectedCaps.maskEdit };
    }
    result = r.reachable ? { ok: !r.authFailed, text: fetchedModels && !r.models.length ? `${r.message} No models reported.` : r.message } : { ok: false, text: `Not reachable: ${r.message}` };
  }
  async function probeDraft(fetchModels: boolean): Promise<void> {
    if (!draft) return;
    busy = fetchModels ? "models" : "probe";
    result = null;
    try {
      applyProbe(await providersStore.probe(draft, draftAuth || undefined), fetchModels);
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      busy = "";
    }
  }
  async function saveDraft(): Promise<void> {
    if (!draft) return;
    busy = "save";
    result = null;
    try {
      if (extraError) throw new Error(extraError);
      const list = draftIsNew ? await providersStore.add(draft, draftAuth || undefined) : await providersStore.update(draft, draftAuth || undefined, clearAuth);
      const saved = list.find((c) => c.id === draft?.id);
      keyStatus = await getKeyStatus().catch(() => keyStatus);
      if (saved) {
        selection = { kind: "custom", id: saved.id };
        loadDraft({ ...saved, capabilities: { ...saved.capabilities }, extra: { ...saved.extra } }, false);
      }
      result = { ok: true, text: draftIsNew ? "Added." : "Saved." };
      draftIsNew = false;
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail || (e instanceof Error ? e.message : String(e)) };
    } finally {
      busy = "";
    }
  }
  async function removeDraft(): Promise<void> {
    if (!draft || draftIsNew) {
      selection = null;
      draft = null;
      return;
    }
    busy = "remove";
    try {
      await providersStore.remove(draft.id);
      selection = null;
      draft = null;
      result = null;
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      busy = "";
    }
  }
  async function searchHub(): Promise<void> {
    busy = "search";
    try {
      hubHits = await hubSearch(hubQuery, hubPipeline, 15);
      if (!hubHits.length) result = { ok: false, text: "No models matched." };
    } catch (e) {
      result = { ok: false, text: toFriendlyError(e).detail };
    } finally {
      busy = "";
    }
  }
  function pickHub(m: HubModel): void {
    if (!draft) return;
    draft.model = m.id;
    draft.capabilities = { ...draft.capabilities, generate: m.pipelineTag === "text-to-image" || !m.pipelineTag, instructEdit: m.pipelineTag === "image-to-image" };
    hubHits = [];
  }
  function setCap<K extends keyof Capabilities>(key: K, value: Capabilities[K]): void {
    if (draft) draft.capabilities = { ...draft.capabilities, [key]: value };
  }

  function open(url: string): void {
    if (hasTauri()) void openUrl(url).catch(() => window.open(url, "_blank"));
    else window.open(url, "_blank");
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (addOpen) addOpen = false;
      else onclose();
    }
  }
  function statusDot(id: ProviderId): boolean {
    return keyStatus[id] ?? false;
  }
  function kindLabel(kind: CustomKind): string {
    return providersStore.kindInfo(kind).label;
  }
  function fmtCount(n: number): string {
    return n.toLocaleString();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="aiprov-title" bind:this={panel}>
    <header>
      <h2 id="aiprov-title">AI Providers</h2>
      <button type="button" class="icon" aria-label="Close" onclick={onclose}>✕</button>
    </header>

    <div class="body">
      <nav class="list" aria-label="Providers">
        <div class="group">Built-in</div>
        {#each PROVIDER_IDS as id (id)}
          {@const info = providersStore.byId(id)}
          <button type="button" class="row" class:on={selection?.kind === "builtin" && selection.id === id} onclick={() => selectBuiltin(id)}>
            <span class="dot" class:ok={info?.authActive === "subscription" ? !!info.account : statusDot(id)}></span>
            <span class="rname">{PROVIDER_LABEL[id]}</span>
            <span class="rsub">{info?.authActive === "subscription" ? "subscription" : PROVIDER_VENDOR[id]}</span>
          </button>
        {/each}
        <div class="group">Custom &amp; local</div>
        {#each customs as c (c.id)}
          <button type="button" class="row" class:on={selection?.kind === "custom" && selection.id === c.id} onclick={() => selectCustom(c.id)}>
            <span class="dot" class:ok={c.hasAuth || (!providersStore.kindInfo(c.kind).requiresAuth && (providersStore.probes[c.id]?.reachable ?? true))}></span>
            <span class="rname">{c.kind === "ollama" ? "✨ " : ["comfy_ui", "a1111", "ollama"].includes(c.kind) ? "🖥 " : ""}{c.name}</span>
            <span class="rsub">{kindLabel(c.kind)}</span>
          </button>
        {/each}
        {#if selection?.kind === "new" && draft}
          <div class="row on"><span class="dot"></span><span class="rname">{draft.name || "New provider"}</span><span class="rsub">unsaved</span></div>
        {/if}
        <div class="add">
          <button type="button" class="btn" onclick={() => (addOpen = !addOpen)} aria-expanded={addOpen}>+ Add ▾</button>
          {#if addOpen}
            <div class="menu" role="menu">
              {#each kinds as k (k.kind)}
                <button type="button" class="mitem" role="menuitem" onclick={() => startAdd(k.kind)}>
                  <span class="mlabel">{k.label}</span>
                  <span class="mdesc">{k.description}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </nav>

      <section class="form">
        {#if selection?.kind === "builtin"}
          {@const id = selection.id}
          {@const fl = oauthStore.flow(id)}
          {@const st = fl.status}
          {@const mode = authModeOf(st, providersStore.byId(id))}
          {@const view = subscriptionView(fl, st)}
          <div class="ftitle">{PROVIDER_LABEL[id]} <span class="muted">· {PROVIDER_VENDOR[id]}</span>
            {#if mode === "api_key"}<button type="button" class="link" onclick={() => open(PROVIDER_CONSOLE_URL[id])}>Get a key ↗</button>{/if}
          </div>
          {#if id !== "gemini"}
            <div class="authrow">
              <span class="muted">Authentication</span>
              <Segmented ariaLabel="Authentication" value={mode} items={authItems(id)} disabled={oauthStore.busy[id] === "config"} onchange={(v) => void setMode(id, v as AuthMode)} />
            </div>
          {/if}
          {#if mode === "subscription" && id === "open_ai"}
            <div class="sub" data-testid="siwc-panel">
              {#if view === "signed_in"}
                <div class="acct">
                  <span class="dot ok"></span>
                  <span>Signed in as <b>{fl.email ?? st?.email ?? "your ChatGPT account"}</b></span>
                  <span class="muted">· Plan: {fl.plan ?? st?.plan ?? "not shared with apps by OpenAI"}</span>
                </div>
                <p class="hint">{st?.planUsage === false ? "⚠ The plan-usage permission was not granted: you're signed in, but requests can't use your ChatGPT plan. Sign out and sign in again to grant it." : "Using ChatGPT plan · eligible usage in this app uses your ChatGPT plan and counts toward the per-app limit you set in ChatGPT."}
                  <button type="button" class="link" onclick={() => open(st?.manageUrl ?? "https://chatgpt.com/settings/usage")}>Manage usage ↗</button>
                </p>
                <p class="hint">✨ Improve prompt runs on your plan{st?.models?.length ? ` (${st.models.map((m) => m.displayName).join(", ")})` : ""}.</p>
                <div class="actions">
                  <button type="button" class="btn" disabled={!!oauthStore.busy[id]} onclick={() => void oauthStore.checkImages(id)}>{oauthStore.busy[id] === "check" ? "Checking…" : "Check image access"}</button>
                  <button type="button" class="btn danger" disabled={!!oauthStore.busy[id]} onclick={() => void oauthStore.signOut(id)}>{oauthStore.busy[id] === "signout" ? "Signing out…" : "Sign out"}</button>
                </div>
                {#if fl.images}
                  <p class="result" class:ok={fl.images.eligible} class:bad={!fl.images.eligible} data-testid="image-access">{fl.images.eligible ? "✓ Images: allowed." : "✕ Images: not available on your plan."} <span class="muted">{fl.images.detail}</span></p>
                  {#if !fl.images.eligible && fl.images.source === "docs"}
                    <p class="hint">Want to be sure for your account? <button type="button" class="link" disabled={!!oauthStore.busy[id]} onclick={() => void liveCheck(id)}>{oauthStore.busy[id] === "live" ? "Testing…" : "Run a live test"}</button> — sends one small image request with your plan; if OpenAI allows it, it uses one image of your plan.</p>
                  {/if}
                {/if}
                <label class="check"><input type="checkbox" checked={st?.fallbackToKey ?? false} disabled={!statusDot(id) || !!oauthStore.busy[id]} onchange={(e) => void oauthStore.configure(id, { fallbackToKey: (e.currentTarget as HTMLInputElement).checked })} /> Fall back to API key when the plan limit is hit{#if !statusDot(id)}<span class="muted"> (save an API key first)</span>{/if}</label>
              {:else if view === "waiting"}
                <p class="waiting"><span class="spin"></span> {fl.phase === "starting" ? "Opening your browser…" : "Finish signing in in your browser. This window updates by itself."}</p>
                {#if fl.start?.browserFailed}<p class="hint">Your browser didn't open.</p>{/if}
                <div class="actions">
                  <button type="button" class="btn" onclick={() => void oauthStore.cancel(id)}>Cancel</button>
                  {#if fl.start?.authUrl}<button type="button" class="link" onclick={() => open(fl.start?.authUrl ?? "")}>Open the sign-in page again ↗</button>{/if}
                </div>
              {:else}
                <p class="hint">Use your ChatGPT Plus or Pro plan instead of an API key. Eligible usage in this app uses your ChatGPT plan. OpenAI's plan usage covers text (Pixelforge uses it for ✨ Improve prompt); <b>image generation isn't available on ChatGPT plans in third-party apps</b>, so images still need an API key.
                  <button type="button" class="link" onclick={() => open(LIMITATIONS_URL)}>OpenAI's limitations ↗</button></p>
                <button type="button" class="siwc" onclick={() => void oauthStore.start(id)}>Sign in with ChatGPT</button>
                {#if fl.phase === "error" && fl.error}<p class="result bad">✕ {fl.error}</p>{/if}
              {/if}
            </div>
          {:else if mode === "subscription" && id === "x_ai"}
            <div class="sub" data-testid="xai-panel">
              {#if view === "unavailable"}
                <button type="button" class="siwc" disabled title="Awaiting xAI approval">Sign in with SuperGrok — awaiting xAI approval for Pixelforge</button>
                <p class="hint">xAI lets a few named open-source apps sign in with SuperGrok / X Premium, but it hasn't published a way for other apps to register, and those apps use xAI's own shared client. Pixelforge won't borrow another app's credentials, so this stays off until xAI issues Pixelforge its own OAuth client ID. Use an xAI API key meanwhile.
                  <button type="button" class="link" onclick={() => open(XAI_RESEARCH_URL)}>Why, and how we've applied ↗</button></p>
              {:else if view === "signed_in"}
                <div class="acct"><span class="dot ok"></span><span>Signed in as <b>{fl.email ?? st?.email ?? "your xAI account"}</b></span><span class="muted">· Plan: {fl.plan ?? st?.plan ?? "SuperGrok / X Premium"}</span></div>
                <div class="actions">
                  <button type="button" class="btn" disabled={!!oauthStore.busy[id]} onclick={() => void oauthStore.checkImages(id)}>{oauthStore.busy[id] === "check" ? "Checking…" : "Check image access"}</button>
                  <button type="button" class="btn danger" disabled={!!oauthStore.busy[id]} onclick={() => void oauthStore.signOut(id)}>{oauthStore.busy[id] === "signout" ? "Signing out…" : "Sign out"}</button>
                </div>
                {#if fl.images}
                  <p class="result" class:ok={fl.images.eligible} class:bad={!fl.images.eligible && fl.images.source !== "unknown"} data-testid="image-access">{fl.images.eligible ? "✓ Images: allowed." : fl.images.source === "unknown" ? "? Images: not documented by xAI." : "✕ Images: not available."} <span class="muted">{fl.images.detail}</span></p>
                  {#if fl.images.source !== "live"}<p class="hint"><button type="button" class="link" onclick={() => void liveCheck(id)}>{oauthStore.busy[id] === "live" ? "Testing…" : "Run a live test"}</button> — one small Grok Imagine request on your plan.</p>{/if}
                {/if}
                <label class="check"><input type="checkbox" checked={st?.fallbackToKey ?? false} disabled={!statusDot(id) || !!oauthStore.busy[id]} onchange={(e) => void oauthStore.configure(id, { fallbackToKey: (e.currentTarget as HTMLInputElement).checked })} /> Fall back to API key when the plan limit is hit{#if !statusDot(id)}<span class="muted"> (save an API key first)</span>{/if}</label>
              {:else if view === "waiting"}
                {#if fl.start?.userCode}
                  <p class="hint">Enter this code at <button type="button" class="link" onclick={() => open(fl.start?.authUrl ?? "")}>{fl.start.verificationUri}</button>:</p>
                  <div class="code"><span data-testid="user-code">{fl.start.userCode}</span>
                    <button type="button" class="btn" onclick={() => void copy(fl.start?.userCode ?? "")}>{copied ? "Copied" : "Copy"}</button>
                    <button type="button" class="btn" onclick={() => open(fl.start?.authUrl ?? "")}>Open browser</button>
                  </div>
                {/if}
                <p class="waiting"><span class="spin"></span> {fl.phase === "starting" ? "Requesting a code…" : "Waiting for you to approve in the browser…"}</p>
                <div class="actions"><button type="button" class="btn" onclick={() => void oauthStore.cancel(id)}>Cancel</button></div>
              {:else}
                <p class="hint">Use your SuperGrok or X Premium subscription instead of an xAI API key. You'll get a short code to approve on x.ai.</p>
                <button type="button" class="siwc" onclick={() => void oauthStore.start(id)}>Sign in with SuperGrok</button>
                {#if fl.phase === "error" && fl.error}<p class="result bad">✕ {fl.error}</p>{/if}
              {/if}
              <label class="field">
                <span>xAI OAuth client ID (issued to Pixelforge by xAI){st?.clientIdSource === "env" ? " — set by PF_XAI_OAUTH_CLIENT_ID" : ""}</span>
                <span class="inrow">
                  <input type="text" bind:value={xaiClientId} placeholder={st?.clientIdSource === "settings" ? "Saved; paste a new one to replace it" : "Empty until xAI issues one"} spellcheck="false" autocomplete="off" disabled={st?.clientIdSource === "env"} />
                  <button type="button" class="btn" disabled={st?.clientIdSource === "env" || !!oauthStore.busy[id]} onclick={() => void saveClientId()}>Save</button>
                  {#if st?.clientIdSource === "settings"}<button type="button" class="btn" onclick={() => void clearClientId()}>Clear</button>{/if}
                </span>
              </label>
            </div>
          {:else}
          {#if id === "gemini"}
            <p class="hint">Subscription sign-in isn't available for Gemini: Google AI Pro / Ultra benefits apply only inside Google AI Studio, and the Gemini API is billed separately. <button type="button" class="link" onclick={() => open("https://ai.google.dev/gemini-api/docs/google-ai-plans")}>Google's plan terms ↗</button></p>
          {/if}
          <label class="field">
            <span>API key</span>
            <span class="inrow">
              <input type={showKey ? "text" : "password"} bind:value={keyValue} placeholder={statusDot(id) ? "Key saved; paste a new one to replace it" : `Paste your ${PROVIDER_VENDOR[id]} API key`} autocomplete="off" spellcheck="false" onkeydown={(e) => e.key === "Enter" && keyValue.trim() && void saveBuiltin(id)} />
              <button type="button" class="icon" title={showKey ? "Hide" : "Show"} onclick={() => (showKey = !showKey)}>{showKey ? "🙈" : "👁"}</button>
            </span>
          </label>
          <div class="actions">
            <button type="button" class="btn primary" disabled={!keyValue.trim() || busy !== ""} onclick={() => void saveBuiltin(id)}>Save</button>
            <button type="button" class="btn" disabled={(!statusDot(id) && !keyValue.trim()) || busy !== ""} onclick={() => void testBuiltin(id)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
            <button type="button" class="btn danger" disabled={!statusDot(id) || busy !== ""} onclick={() => void deleteBuiltin(id)}>Delete key</button>
          </div>
          {/if}
        {:else if draft && kindInfo}
          <div class="ftitle">{draftIsNew ? "New: " : ""}{kindInfo.label}
            <button type="button" class="link" onclick={() => open(kindInfo.helpUrl)}>{kindInfo.requiresAuth ? "Get a token ↗" : "Install / docs ↗"}</button>
          </div>
          <p class="hint">{kindInfo.description}.
            {#if draft.kind === "ollama"}Ollama's API has no image output, so this entry only powers "✨ Improve prompt" with a vision model (llava, qwen2.5vl, gemma3).{/if}
            {#if draft.kind === "openai_compat"}LM Studio has no image endpoint; LocalAI and vLLM-Omni do. Tick "instruct edit" only if the server implements /v1/images/edits.{/if}
            {#if draft.kind === "hugging_face"}Serverless router by default; paste an Inference Endpoint URL as base URL to use a dedicated deployment. No pixel masks: mask edits are emulated.{/if}
            {#if draft.kind === "a1111"}Start the WebUI with --api (and --api-auth user:pass if you want a login).{/if}
            {#if draft.kind === "comfy_ui"}Uses bundled API-format workflows; paste your own exported "API format" workflow with placeholders to override.{/if}
          </p>
          <div class="two">
            <label class="field"><span>Name</span><input type="text" bind:value={draft.name} oninput={onNameInput} /></label>
            <label class="field"><span>Id</span><input type="text" bind:value={draft.id} disabled={!draftIsNew} oninput={() => (idTouched = true)} pattern="[a-z0-9][a-z0-9-]*" /></label>
          </div>
          <label class="field"><span>Base URL</span><input type="text" bind:value={draft.baseUrl} placeholder={kindInfo.defaultBaseUrl} spellcheck="false" /></label>
          <label class="field">
            <span>{draft.kind === "comfy_ui" || draft.kind === "a1111" ? "Checkpoint" : draft.kind === "hugging_face" ? "Model (repo id)" : draft.kind === "replicate" ? "Model (owner/name)" : "Model"}</span>
            <span class="inrow">
              <input type="text" bind:value={draft.model} list="aiprov-models" placeholder={draft.kind === "hugging_face" ? "stabilityai/stable-diffusion-xl-base-1.0" : draft.kind === "replicate" ? "black-forest-labs/flux-schnell" : draft.kind === "ollama" ? "llava" : "fetch models or type one"} spellcheck="false" />
              <datalist id="aiprov-models">{#each modelOptions as m (m)}<option value={m}></option>{/each}</datalist>
              {#if modelOptions.length}
                <select aria-label="Pick a model" value={draft.model} onchange={(e) => draft && (draft.model = (e.currentTarget as HTMLSelectElement).value)}>
                  {#each modelOptions as m (m)}<option value={m}>{m}</option>{/each}
                </select>
              {/if}
            </span>
          </label>
          {#if draft.kind === "hugging_face"}
            <div class="hub">
              <input type="text" bind:value={hubQuery} placeholder="Search the Hub (flux, sdxl, kontext…)" onkeydown={(e) => e.key === "Enter" && void searchHub()} />
              <select bind:value={hubPipeline}><option value="text-to-image">text-to-image</option><option value="image-to-image">image-to-image</option></select>
              <button type="button" class="btn" disabled={busy !== ""} onclick={() => void searchHub()}>{busy === "search" ? "…" : "Search"}</button>
            </div>
            {#if hubHits.length}
              <ul class="hits">
                {#each hubHits as m (m.id)}
                  <li><button type="button" onclick={() => pickHub(m)}><span class="hid">{m.id}</span><span class="hmeta">{m.pipelineTag ?? "?"} · {fmtCount(m.downloads)} dl · {fmtCount(m.likes)} ♥{m.gated ? " · gated" : ""}</span></button></li>
                {/each}
              </ul>
            {/if}
          {/if}
          <label class="field">
            <span>{draft.kind === "a1111" ? "Token or user:pass (optional)" : kindInfo.requiresAuth ? "Token" : "API key (optional)"}</span>
            <span class="inrow">
              <input type={showKey ? "text" : "password"} bind:value={draftAuth} placeholder={draft.hasAuth && !clearAuth ? "Stored; paste a new one to replace it" : kindInfo.requiresAuth ? "Required" : "Leave empty for a local server"} autocomplete="off" spellcheck="false" />
              <button type="button" class="icon" title={showKey ? "Hide" : "Show"} onclick={() => (showKey = !showKey)}>{showKey ? "🙈" : "👁"}</button>
              {#if draft.hasAuth}<label class="check"><input type="checkbox" bind:checked={clearAuth} /> clear stored</label>{/if}
            </span>
          </label>
          {#if isSd || draft.kind === "openai_compat" || draft.kind === "hugging_face" || draft.kind === "replicate"}
            <div class="grid4">
              <label class="field"><span>Steps</span><input type="number" min="1" max="150" value={num("steps")} onchange={(e) => setExtraNum("steps", e)} placeholder="20" /></label>
              <label class="field"><span>CFG</span><input type="number" min="0" max="30" step="0.5" value={num("cfg")} onchange={(e) => setExtraNum("cfg", e)} placeholder="7" /></label>
              {#if isSd}
                <label class="field"><span>Sampler</span><input type="text" value={str("sampler")} onchange={(e) => setExtraStr("sampler", e)} placeholder={draft.kind === "a1111" ? "Euler a" : "euler"} /></label>
                <label class="field"><span>Scheduler</span><input type="text" value={str("scheduler")} onchange={(e) => setExtraStr("scheduler", e)} placeholder="normal" /></label>
              {/if}
              <label class="field"><span>Denoise</span><input type="number" min="0" max="1" step="0.05" value={num("denoise")} onchange={(e) => setExtraNum("denoise", e)} placeholder="0.75" /></label>
              <label class="field"><span>Seed</span><input type="number" min="-1" value={num("seed")} onchange={(e) => setExtraNum("seed", e)} placeholder="random" /></label>
              {#if draft.kind === "a1111"}
                <label class="field"><span>Mask blur</span><input type="number" min="0" max="64" value={num("maskBlur")} onchange={(e) => setExtraNum("maskBlur", e)} placeholder="4" /></label>
                <label class="field"><span>Masked content</span>
                  <select value={num("inpaintingFill") === "" ? 1 : num("inpaintingFill")} onchange={(e) => setExtra("inpaintingFill", Number((e.currentTarget as HTMLSelectElement).value))}>
                    <option value={0}>fill</option><option value={1}>original</option><option value={2}>latent noise</option><option value={3}>latent nothing</option>
                  </select>
                </label>
              {/if}
              {#if draft.kind === "replicate"}
                <label class="field"><span>Version (optional)</span><input type="text" value={str("version")} onchange={(e) => setExtraStr("version", e)} placeholder="64-hex version id" /></label>
                <label class="field"><span>Image input field</span><input type="text" value={str("imageField")} onchange={(e) => setExtraStr("imageField", e)} placeholder="image" /></label>
              {/if}
            </div>
          {/if}
          {#if draft.kind === "comfy_ui"}
            <div class="field">
              <span class="inrow">Workflow (API format, optional)
                <button type="button" class="link" onclick={() => void loadTemplate("txt2img")}>Load txt2img</button>
                <button type="button" class="link" onclick={() => void loadTemplate("img2img")}>img2img</button>
                <button type="button" class="link" onclick={() => void loadTemplate("inpaint")}>inpaint</button>
              </span>
              <textarea rows="5" bind:value={workflowText} onchange={onWorkflowText} spellcheck="false" placeholder={"Paste a workflow saved with \"Save (API format)\". Placeholders: {{prompt}} {{negative}} {{image}} {{mask}} {{width}} {{height}} {{seed}} {{steps}} {{cfg}} {{checkpoint}} {{denoise}} {{sampler}} {{scheduler}} {{batch}}"}></textarea>
            </div>
          {/if}
          {#if draft.kind !== "ollama"}
            <div class="caps">
              <span class="muted">Can:</span>
              <label class="check"><input type="checkbox" checked={draft.capabilities.generate} onchange={(e) => setCap("generate", (e.currentTarget as HTMLInputElement).checked)} /> generate</label>
              <label class="check"><input type="checkbox" checked={draft.capabilities.instructEdit} onchange={(e) => setCap("instructEdit", (e.currentTarget as HTMLInputElement).checked)} /> instruct edit</label>
              <label class="check"><input type="checkbox" checked={draft.capabilities.maskEdit} onchange={(e) => setCap("maskEdit", (e.currentTarget as HTMLInputElement).checked)} /> native mask{#if !draft.capabilities.maskEdit}<span class="muted"> (emulated)</span>{/if}</label>
              <label class="check">max variants <input type="number" class="tiny" min="1" max="10" value={draft.capabilities.maxVariants} onchange={(e) => setCap("maxVariants", Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1))} /></label>
              <label class="check">max px <input type="number" class="tiny" min="64" step="64" value={draft.capabilities.maxPx} onchange={(e) => setCap("maxPx", Math.max(64, Number((e.currentTarget as HTMLInputElement).value) || 2048))} /></label>
            </div>
          {/if}
          <button type="button" class="disclosure" onclick={() => (showAdvanced = !showAdvanced)} aria-expanded={showAdvanced}>{showAdvanced ? "▾" : "▸"} Advanced (extra JSON)</button>
          {#if showAdvanced}
            <textarea rows="4" bind:value={extraText} onchange={onExtraText} spellcheck="false"></textarea>
          {/if}
          {#if extraError}<p class="result bad">{extraError}</p>{/if}
          <div class="actions">
            <button type="button" class="btn" disabled={busy !== ""} onclick={() => void probeDraft(false)}>{busy === "probe" ? "Testing…" : "Test connection"}</button>
            <button type="button" class="btn" disabled={busy !== "" || draft.kind === "replicate"} onclick={() => void probeDraft(true)}>{busy === "models" ? "Fetching…" : "Fetch models"}</button>
            <button type="button" class="btn primary" disabled={busy !== "" || !draft.name.trim() || !draft.id.trim() || !draft.baseUrl.trim()} onclick={() => void saveDraft()}>{busy === "save" ? "Saving…" : draftIsNew ? "Add" : "Save"}</button>
            <button type="button" class="btn danger" disabled={busy !== ""} onclick={() => void removeDraft()}>{draftIsNew ? "Cancel" : "Remove"}</button>
          </div>
          {#if probe}
            <p class="probe" class:bad={!probe.reachable || probe.authFailed}>
              {probe.reachable ? (probe.authFailed ? "⚠ reachable, credentials rejected" : "✓ reachable") : "✕ unreachable"}{probe.version ? ` · ${probe.version}` : ""}{probe.models.length ? ` · ${probe.models.length} model${probe.models.length === 1 ? "" : "s"}` : ""}{isLocalKind ? " · local, no cost" : ""}
            </p>
          {/if}
        {:else}
          <p class="hint">Pick a provider on the left, or add a custom / local one.</p>
        {/if}
        {#if result}
          <p class="result" class:ok={result.ok} class:bad={!result.ok}>{result.ok ? "✓" : "✕"} {result.text}</p>
        {/if}
      </section>
    </div>

    <footer>
      <p>Pixelforge calls each vendor's API directly with your own key, or with your ChatGPT subscription where OpenAI officially allows it (text only: images need a key). Grok subscription sign-in waits on xAI issuing Pixelforge a client ID; Google AI Pro never covers the API. Local servers (ComfyUI, WebUI, Ollama, LocalAI) cost nothing per image.</p>
      <p class="muted">
        {#if backend === "keyring"}Keys and tokens are stored in the OS keychain and never shown again.{:else if backend === "file"}No OS keychain is available: keys are kept in a local file, obfuscated but not encrypted.{:else}Keys are stored in the OS keychain where available, otherwise in an obfuscated local file.{/if}
        Custom providers live in ai-providers.json in the app config folder.
      </p>
    </footer>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); }
  .dialog { width: min(820px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--bg-1); border: 1px solid var(--border-strong); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6); color: var(--fg-1); font-size: 11px; }
  header { display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--border); }
  h2 { margin: 0; font-size: 12px; font-weight: 600; color: var(--fg-0); }
  .body { display: grid; grid-template-columns: 220px 1fr; min-height: 380px; max-height: calc(100vh - 160px); }
  .list { border-right: 1px solid var(--border); overflow-y: auto; background: var(--bg-0); display: flex; flex-direction: column; }
  .group { padding: 6px 8px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-2); }
  .row { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; width: 100%; text-align: left; color: var(--fg-1); }
  .row:hover { background: var(--bg-2); color: var(--fg-0); }
  .row.on { background: var(--bg-3); color: var(--fg-0); }
  .rname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rsub { color: var(--fg-2); font-size: 10px; white-space: nowrap; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-2); flex: none; }
  .dot.ok { background: #43d17a; }
  .add { position: relative; padding: 6px 8px; margin-top: auto; }
  .menu { position: absolute; left: 8px; right: 8px; bottom: 30px; background: var(--bg-1); border: 1px solid var(--border-strong); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6); z-index: 2; }
  .mitem { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; padding: 4px 8px; color: var(--fg-1); }
  .mitem:hover { background: var(--bg-3); color: var(--fg-0); }
  .mlabel { font-weight: 600; }
  .mdesc { font-size: 10px; color: var(--fg-2); }
  .form { padding: 8px 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .ftitle { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--fg-0); height: 22px; }
  .ftitle .link { margin-left: auto; font-weight: 400; }
  .hint { margin: 0; color: var(--fg-2); line-height: 1.4; }
  .field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .field > span:first-child { color: var(--fg-2); font-size: 10px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .inrow { display: flex; gap: 4px; align-items: center; }
  .inrow input, .inrow select { flex: 1; min-width: 0; }
  input, select, textarea { height: 18px; font: inherit; font-size: 11px; color: var(--fg-0); background: var(--bg-0); border: 1px solid var(--border-strong); border-radius: 2px; padding: 0 5px; user-select: text; -webkit-user-select: text; }
  input[type="password"] { font-family: var(--font-mono, monospace); }
  textarea { height: auto; padding: 4px 5px; font-family: var(--font-mono, monospace); resize: vertical; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
  input:disabled { opacity: 0.5; }
  .tiny { width: 52px; flex: none; }
  .check { display: inline-flex; align-items: center; gap: 4px; color: var(--fg-1); white-space: nowrap; }
  .check input[type="checkbox"] { height: auto; }
  .caps { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .hub { display: flex; gap: 4px; }
  .hub input { flex: 1; }
  .hits { list-style: none; margin: 0; padding: 0; max-height: 120px; overflow-y: auto; border: 1px solid var(--border); }
  .hits button { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; height: 22px; padding: 0 6px; color: var(--fg-1); }
  .hits button:hover { background: var(--bg-3); color: var(--fg-0); }
  .hid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hmeta { color: var(--fg-2); font-size: 10px; white-space: nowrap; }
  .actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .btn { height: 20px; padding: 0 8px; border-radius: 2px; background: var(--bg-3); color: var(--fg-1); border: 1px solid var(--border); }
  .btn:hover:not(:disabled) { color: var(--fg-0); }
  .btn:disabled { opacity: 0.4; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.danger:hover:not(:disabled) { color: var(--danger, #ff5c7a); }
  .icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 18px; border-radius: 2px; color: var(--fg-2); }
  .icon:hover { color: var(--fg-0); background: var(--bg-3); }
  .link { color: var(--accent-2, var(--accent)); font-size: 10px; }
  .link:hover { text-decoration: underline; }
  .disclosure { align-self: flex-start; color: var(--fg-2); font-size: 10px; }
  .result, .probe { margin: 0; }
  .result.ok, .probe { color: #43d17a; }
  .result.bad, .probe.bad { color: var(--danger, #ff5c7a); }
  footer { border-top: 1px solid var(--border); padding: 6px 10px; }
  footer p { margin: 0 0 3px; line-height: 1.4; }
  .muted { color: var(--fg-2); }
  .authrow { display: flex; align-items: center; gap: 8px; }
  .sub { display: flex; flex-direction: column; gap: 6px; padding: 6px 8px; border: 1px solid var(--border); background: var(--bg-0); border-radius: 2px; }
  .acct { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  /* OpenAI's UI guidelines: a "Sign in with ChatGPT" / "Continue with ChatGPT" label with
     prominence comparable to other sign-in options. Neutral black/white, no borrowed logo. */
  .siwc { align-self: flex-start; height: 26px; padding: 0 14px; border-radius: 13px; background: #0d0d0d; color: #fff; border: 1px solid #3a3a3a; font-weight: 600; font-size: 11px; }
  .siwc:hover:not(:disabled) { background: #262626; }
  .siwc:disabled { opacity: 0.55; cursor: not-allowed; }
  .waiting { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--fg-1); }
  .spin { width: 10px; height: 10px; border: 2px solid var(--fg-2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .code { display: flex; align-items: center; gap: 6px; }
  .code span { font-family: var(--font-mono, monospace); font-size: 16px; letter-spacing: 0.12em; color: var(--fg-0); padding: 2px 8px; border: 1px dashed var(--border-strong); }
</style>
