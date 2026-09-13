import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("Hermes readable cleanup", () => {
  it("parses and suppresses TUI reasoning, window warnings and repeated starter prompts", async () => {
    const source = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");
    expect(() => new vm.Script(source, { filename: "chat-v5.js" })).not.toThrow();
    expect(source).toContain("installHermesReadableSanitizer");
    expect(source).toContain("Reasoning");
    expect(source).toContain("Plan a feature, then build it step by step");
    expect(source).toContain("Window too small");
    expect(source).toContain("terminal-tui-hidden");
    expect(source).toContain("terminal-tui-meta");
    expect(source).toContain("Model fallback");
  });

  it("keeps raw PTY available while cleaning only the Readable mirror", async () => {
    const usage = await readFile(new URL("../web/control/chat-usage.js", import.meta.url), "utf8");
    const v5 = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");
    expect(usage).toContain("Raw PTY");
    expect(usage).toContain("hermesTranscript");
    expect(v5).toContain('document.getElementById("hermesTranscript")');
    expect(v5).not.toContain('document.getElementById("hermesTerm").remove');
  });
});
