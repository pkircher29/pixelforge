/**
 * Dev entry for `index.html` next to it. `?page=gpu` mounts the GPU-vs-CPU comparison,
 * anything else the interactive playground (dialogs, live preview, Free Transform).
 */
import { mount } from "svelte";
import "../../../app.css";
import FiltersDemo from "./FiltersDemo.svelte";
import Playground from "./Playground.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app");
const page = new URLSearchParams(location.search).get("page");
mount(page === "gpu" ? FiltersDemo : Playground, { target });
