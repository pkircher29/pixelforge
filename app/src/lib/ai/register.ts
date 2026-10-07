/**
 * Registers the AI panels and commands with the UI registry. The shell imports this
 * module once (`import("$lib/ai/register")`); nothing else in `lib/ai` has side effects.
 */

import { KeyRound, Layers, ScanEye, Sparkles, WandSparkles, RotateCcw } from "@lucide/svelte";
import { docStore } from "$lib/stores/doc.svelte";
import { registerCommands, registerPanel } from "$lib/ui/registry.svelte";
import AiPanel from "$lib/ui/panels/AiPanel.svelte";
import AiHistoryPanel from "$lib/ui/panels/AiHistoryPanel.svelte";
import { assistProviders, improvePrompt } from "./assist";
import { openAiProvidersDialog, openShootoutDialog } from "./dialogs";
import { lastEntry } from "./history";
import { toggleDiffOverlay } from "./overlay";
import { runAi } from "./run";
import { aiUi } from "./ui.svelte";

registerPanel({ id: "ai", title: "AI", dock: "right", order: 31, group: "history", component: AiPanel, icon: "ai", preferredSize: 420 });
registerPanel({ id: "ai-history", title: "AI History", dock: "right", order: 32, group: "history", component: AiHistoryPanel, icon: "ai-history", preferredSize: 240 });

registerCommands([
  {
    // Id kept from v0.1 so existing menu wiring still works; the dialog is now AI Providers.
    id: "settings.apiKeys",
    label: "AI Providers…",
    menu: "Edit",
    order: 900,
    icon: KeyRound,
    keywords: ["settings", "openai", "chatgpt", "grok", "xai", "gemini", "key", "token", "ollama", "comfyui", "stable diffusion", "hugging face", "local", "custom", "api keys"],
    run: () => openAiProvidersDialog(),
  },
  {
    id: "settings.aiProviders",
    label: "AI Providers…",
    icon: KeyRound,
    keywords: ["custom provider", "local model", "comfy", "a1111", "forge", "replicate"],
    run: () => openAiProvidersDialog(),
  },
  {
    id: "ai.generate",
    label: "Generate with AI…",
    menu: "AI",
    order: 100,
    // Ctrl+Shift+G is Photoshop's Ungroup (layer.ungroup owns it); Ctrl+Alt+G is a
    // common OS-level hotkey (e.g. Google Drive for desktop), so add Shift as well.
    shortcut: "CmdOrCtrl+Shift+Alt+G",
    icon: Sparkles,
    keywords: ["image", "prompt", "text to image"],
    run: () => aiUi.focusPrompt("generate"),
  },
  {
    id: "ai.edit",
    label: "Edit selection with AI…",
    menu: "AI",
    order: 110,
    shortcut: "CmdOrCtrl+Shift+A",
    icon: WandSparkles,
    keywords: ["inpaint", "mask", "selection"],
    enabled: () => {
      const d = docStore.doc;
      return Boolean(d && !d.selection.isEmpty);
    },
    run: () => aiUi.focusPrompt("mask"),
  },
  {
    id: "ai.shootout",
    label: "Generate with all models…",
    menu: "AI",
    order: 120,
    shortcut: "CmdOrCtrl+Shift+Alt+M",
    icon: Layers,
    keywords: ["shootout", "compare", "every provider", "run on all", "multi-model"],
    run: () => openShootoutDialog(null),
  },
  {
    id: "ai.improvePrompt",
    label: "Improve prompt with Ollama",
    menu: "AI",
    order: 130,
    icon: WandSparkles,
    keywords: ["prompt assist", "rewrite", "describe image", "llava", "vision"],
    enabled: () => assistProviders().length > 0,
    run: async () => {
      await improvePrompt();
      aiUi.focusPrompt();
    },
  },
  {
    id: "ai.rerunLast",
    label: "Re-run last AI job",
    menu: "AI",
    order: 200,
    icon: RotateCcw,
    enabled: () => aiUi.lastRun !== null,
    run: async () => {
      const req = aiUi.lastRun;
      if (req) await runAi(req);
    },
  },
  {
    id: "ai.toggleDiff",
    label: "Toggle AI diff overlay",
    menu: "AI",
    order: 210,
    icon: ScanEye,
    keywords: ["changed pixels", "compare"],
    enabled: () => {
      const d = docStore.doc;
      return Boolean(d && lastEntry(d)?.resultLayerIds.length);
    },
    run: () => {
      const open = docStore.active;
      if (!open) return;
      const e = lastEntry(open.doc);
      const id = e?.resultLayerIds[e.resultLayerIds.length - 1];
      if (id) toggleDiffOverlay(open, id);
    },
  },
]);
