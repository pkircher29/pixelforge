# `app/src/lib/io` — Webview File I/O, `.pfproj` Conversion & Clipboard

Frontend bridge to the Rust `io_*` Tauri commands (`docs/ipc.md`) and `@tauri-apps/plugin-clipboard-manager`.

## Key Files

| File | Role |
|---|---|
| `frame.ts` | TypeScript mirror of `crates/pf-io/src/frame.rs` (`encodeFrame`, `decodeFrame`): packs and unpacks `[u32 LE header byte length][UTF-8 JSON header][concatenated binary blobs]`. |
| `convert.ts` | Bidirectional conversion between engine `Document` instances and IPC frame headers (`OpenHeader`, `ProjectHeader`, `Manifest` v2): maps layers (raster, group, adjustment, fill, shape, text), masks, effects, locks, links, alpha channels, vector paths, selection, and `doc.meta.aiHistory` <-> `manifest.ai_history` (stripping transient `aidiff_*` overlays). |
| `files.ts` | High-level file operations (`openFile`, `decodeBytes`, `pickOpenPaths`, `pickSavePath`, `saveProject`, `exportComposite`, `encodeRaster`, `recentList`, `recentAdd`, `recentClear`) and `APP_VERSION`. |
| `clipboard.ts` | Internal and OS clipboard integration (`copySelection`, `cutSelection`, `pasteClipboard`, `pasteInPlace`, `pasteIntoSelection`). |
