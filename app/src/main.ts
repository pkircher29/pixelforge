import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Pixelforge: #app mount point is missing from index.html");
}

// The webview is the whole app: no browser context menu, no text selection drag.
document.addEventListener("contextmenu", (e) => {
  if (!import.meta.env.DEV) e.preventDefault();
});

const app = mount(App, { target });

export default app;
