import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "../src/control/chat-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("multi-chat background switching", () => {
  it("reports sessions that are still generating", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-multichat-"));
    roots.push(root);
    const chatRoot = join(root, "chat");
    await mkdir(chatRoot, { recursive: true });
    const sessionId = "123e4567-e89b-42d3-a456-426614174000";
    await writeFile(join(chatRoot, `${sessionId}.json`), JSON.stringify({
      sessionId,
      createdAt: "2026-09-21T15:00:00.000Z",
      updatedAt: "2026-09-21T15:01:00.000Z",
      model: "cx/gpt-5.6-sol",
      messages: [
        {
          id: "u1",
          sessionId,
          role: "user",
          content: "Long task",
          createdAt: "2026-09-21T15:00:00.000Z",
          state: "complete"
        },
        {
          id: "a1",
          sessionId,
          role: "assistant",
          content: "Still working",
          createdAt: "2026-09-21T15:00:01.000Z",
          state: "streaming",
          model: "cx/gpt-5.6-sol"
        }
      ]
    }), "utf8");

    const chat = new ChatService({ stateDir: root });
    const sessions = await chat.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.generating).toBe(true);
    chat.close();
  });

  it("does not disable history/new chat while another session is generating", async () => {
    const [chatJs, historyJs] = await Promise.all([
      readFile(new URL("../web/control/chat.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-history.js", import.meta.url), "utf8")
    ]);

    expect(chatJs).toContain("newChatButton.disabled = state.preparingAttachments");
    expect(chatJs).not.toContain("newChatButton.disabled = state.generating || state.preparingAttachments");
    expect(chatJs).toContain("window.koordynatorLoadChatSession = async");
    expect(chatJs).toContain("state.sessionId !== sessionId");
    expect(chatJs).toContain("messages.some((message) => message?.role === \"assistant\" && message?.state === \"streaming\")");

    expect(historyJs).not.toContain("historyIsGenerating()");
    expect(historyJs).not.toContain("button.disabled = historyIsGenerating()");
    expect(historyJs).toContain("window.koordynatorLoadChatSession");
    expect(historyJs).toContain("● Generating");
    expect(historyJs).not.toContain("if (historyIsGenerating()) return");
  });
});
