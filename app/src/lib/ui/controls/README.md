# `app/src/lib/ui/controls` — Photoshop-Styled Form Controls

Reusable compact UI controls matching Photoshop CC's panel and dialog density.

## Key Files

| File | Component / Helper |
|---|---|
| `Popover.svelte` | Floating portal-mounted popover positioned relative to an anchor element so dropdowns inside modal dialogs are never clipped. |
| `PsSelect.svelte` | Custom keyboard-navigable dropdown select using `Popover.svelte`. |
| `ScrubbyNumber.svelte`, `scrubby.ts` | Numeric input with drag-on-label "scrubby slider" behavior (`Shift` = 10x step, `Alt` = 0.1x step) and arrow-key stepping. |
| `Segmented.svelte` | Compact segmented button group for mutually exclusive mode/alignment toggles. |
