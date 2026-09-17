import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredIds = [
  "chatWorkspace",
  "chatFrame",
  "chatThread",
  "messageInput",
  "modelSelect",
  "sendButton",
  "stopButton",
  "historyButton",
  "newChatButton",
  "stageZeroButton",
  "muteHermesButton",
  "hermesPane",
  "hermesTerm",
  "startHermesButton",
  "stopHermesButton",
  "hermesInput",
  "sendHermesButton",
  "githubChatButton",
  "githubChatConsentDialog",
  "primaryRouteLabel",
  "fallbackRoutesLabel",
  "workspaceSplitter"
];

describe("Live Workspace V5", () => {
  it("is a fresh screen with the complete runtime contract", async () => {
    const html = await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8");

    expect(html).toContain("Koordynator · Live Workspace");
    expect(html).toContain('/chat-v5.css?v=5');
    expect(html).toContain('/chat-v5.js?v=5');
    expect(html).not.toContain("control-workspace-v3");
    expect(html).not.toContain("control-workspace-v4");

    for (const id of requiredIds) expect(html).toContain(`id="${id}"`);
  });

  it("keeps Hermes PTY as a first-class resizable pane", async () => {
    const css = await readFile(new URL("../web/control/chat-v5.css", import.meta.url), "utf8");
    const js = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");

    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 5px var(--terminal-width)");
    expect(css).toContain(".v5-terminal-pane");
    expect(js).toContain("workspaceSplitter");
    expect(js).toContain("setTerminalWidth");
  });

  it("surfaces backend primary and fallback routing explicitly", async () => {
    const js = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");

    expect(js).toContain("chatDefaultModel");
    expect(js).toContain("chatFallbackModels");
    expect(js).toContain("ensureBackendPrimary");
  });
});
