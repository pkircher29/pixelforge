import { expect, it } from "vitest";
import { aiUi } from "../../lib/ai/ui.svelte";
import { ui } from "../../lib/stores/ui.svelte";

it("reveals the AI panel from a hidden, collapsed and iconized dock", () => {
  ui.placePanel("ai", "history");
  const group = ui.groupOf("ai")!;
  group.active = "history";
  group.collapsed = true;
  ui.hiddenPanels.push("ai");
  ui.workspace.iconized = true;
  const request = aiUi.focusRequest;
  aiUi.focusPrompt("generate");
  expect(group.active).toBe("ai");
  expect(group.collapsed).toBe(false);
  expect(ui.hiddenPanels).not.toContain("ai");
  expect(ui.workspace.iconized).toBe(false);
  expect(aiUi.forcedMode).toBe("generate");
  expect(aiUi.focusRequest).toBe(request + 1);
});
