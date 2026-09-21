import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "../src/control/chat-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("chat runtime stability", () => {
  it("repairs orphaned streaming messages after a server restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-stability-"));
    roots.push(root);
    const chat = new ChatService({ stateDir: root, apiKey: "test-key" });
    try {
      const session = await chat.createSession("oc/test-free");
      const path = join(root, "chat", `${session.sessionId}.json`);
      const stored = JSON.parse(await readFile(path, "utf8"));
      stored.messages.push(
        {
          id: "user-1",
          sessionId: session.sessionId,
          role: "user",
          content: "hello",
          createdAt: "2026-09-21T03:00:00.000Z",
          state: "complete"
        },
        {
          id: "assistant-1",
          sessionId: session.sessionId,
          role: "assistant",
          content: "partial answer",
          createdAt: "2026-09-21T03:00:01.000Z",
          state: "streaming",
          model: "oc/test-free"
        }
      );
      await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

      const recovered = await chat.recoverSession(session.sessionId);
      expect(recovered?.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: "partial answer",
        state: "stopped"
      });

      const persisted = JSON.parse(await readFile(path, "utf8"));
      expect(persisted.messages.at(-1).state).toBe("stopped");
      expect(typeof persisted.messages.at(-1).completedAt).toBe("string");
    } finally {
      chat.close();
    }
  });

  it("keeps frontend recovery hooks for chat and Hermes wired", async () => {
    const js = await readFile(new URL("../web/control/chat.js", import.meta.url), "utf8");
    expect(js).toContain("reconcileChatSession");
    expect(js).toContain("ensureHermesTerminalGrant");
    expect(js).toContain("restoreHermesPty");
    expect(js).toContain('stopButton.classList.remove("hidden")');
    expect(js).toContain('model: modelSelect.value');
  });
});
