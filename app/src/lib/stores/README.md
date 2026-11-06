# `app/src/lib/stores` — Svelte 5 Runes Application Stores

Reactive state stores (`.svelte.ts`) wrapping the pure-TypeScript engine and application preferences.

## Key Files

| File | Export | Responsibility |
|---|---|---|
| `doc.svelte.ts` | `docStore` | Multi-document tab manager (`OpenDoc[]`): tracks open documents, `activeId`, `active` document, `activeLayer`, mask-editing target (`editingMask`), channel view (`viewChannel`), per-document `History` stack, `Viewport`, and version counters for reactive UI updates (`exec`, `undo`, `redo`, `touch`). |
| `tool.svelte.ts` | `toolStore` | Active tool ID (`activeToolId`), last-used tool per toolbar fly-out group, foreground/background RGBA colors (`fg`, `bg`, `swapColors`, `resetColors`), per-tool option values and presets, and screen mode (`standard`, `fullscreen-menu`, `fullscreen`). |
| `settings.svelte.ts` | `settings` | User preferences store synchronized with Rust `settings_get` / `settings_set` (`theme`, `defaultProvider`, `historyBudgetMb`, interface/cursor/grid preferences). |
| `ui.svelte.ts` | `ui` | Shell layout state: dock panel visibility, active tabs, collapsed panel groups, workspace reset (`resetEssentials`), modal/command-palette open flags, ruler visibility, and `recentFiles`. |
| `toast.svelte.ts` | `toast` | Ephemeral notification queue (`info`, `success`, `warn`, `error`, `dismiss`) rendered by `Toast.svelte`. |
