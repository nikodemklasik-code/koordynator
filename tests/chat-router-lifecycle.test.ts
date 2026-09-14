import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("Routing Inspector lifecycle", () => {
  it("closes RUNNING on assistant_done and records an outcome, not just start events", async () => {
    const source = await readFile(resolve("web/control/chat-router.js"), "utf8");
    expect(source).toContain('window.addEventListener("koordynator:chat-event"');
    expect(source).toContain('event.type === "assistant_done"');
    expect(source).toContain("Assistant turn completed");
    expect(source).toContain("OUTCOME");
    expect(source).not.toMatch(/if \(bubble && state\.receipt\.phase === "running"\)/);
  });
});
