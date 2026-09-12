import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Live Chat model explorer", () => {
  it("keeps the native executable model select and adds searchable role categories", async () => {
    const [html, controller] = await Promise.all([
      readFile(new URL("../web/control/chat.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8")
    ]);

    expect(html).toContain('id="modelSelect"');
    expect(controller).toContain("modelSearchInput");
    expect(controller).toContain("modelRoleFilter");
    for (const role of [
      "Developer", "Researcher", "Frontend Developer", "Frontend Builder",
      "Builder", "Innovation Developer", "Security"
    ]) {
      expect(controller).toContain(role);
    }
    expect(controller).toContain('modelSelect.dispatchEvent(new Event("change"');
  });
});