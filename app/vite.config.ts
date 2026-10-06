import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

// Tauri sets TAURI_DEV_HOST when developing against a remote device (mobile).
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },

  // Tauri expects a fixed port and fails if it is taken.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Don't let Vite restart when Rust files change.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Keep env vars prefixed TAURI_ENV_* available to the front end.
  envPrefix: ["VITE_", "TAURI_ENV_*"],

  build: {
    // WebView2 on Windows, WebKit on macOS / Linux are all modern.
    target: ["es2022", "chrome105", "safari15"],
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },

  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
