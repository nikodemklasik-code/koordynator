import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ChatMessage } from "../src/control/chat-service.js";
import { isActionableSkillTask, type SkillRun } from "../src/control/hermes-skill-runner.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const EMPTY_ZIP_BASE64 = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==";

describe("Live Chat dynamic Hermes skill routing", () => {
  it("recognises decomposition/build intents with attachments but leaves ordinary attachment Q&A alone", () => {
    expect(isActionableSkillTask("podziel na mniejsze elementy", 1)).toBe(true);
    expect(isActionableSkillTask("Rozbij ten ZIP na moduły", 1)).toBe(true);
    expect(isActionableSkillTask("implement this package", 1)).toBe(true);
    expect(isActionableSkillTask("streść zawartość załącznika", 1)).toBe(false);
    expect(isActionableSkillTask("podziel plan na części", 0)).toBe(false);
    expect(isActionableSkillTask("/skill podziel plan na części", 0)).toBe(true);
    expect(isActionableSkillTask("/repo https://github.com/a/b fix", 1)).toBe(false);
  });

  it("routes ZIP + natural-language decomposition through injected Hermes skill executor and persists the result", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-skills-"));
    roots.push(root);
    const calls: SkillRun[] = [];
    const chat = new ChatService({
      stateDir: root,
      apiKey: "fixture-key",
      defaultModel: "oc/test-model",
      skillExecutor: async (run) => {
        calls.push(run);
        expect(run.attachments).toHaveLength(1);
        expect(run.attachments[0]?.name).toBe("codepack.zip");
        run.emit("Podział wykonany.\nSKILLS_USED: codebase-inspection, planning\n");
      }
    });
    const session = await chat.createSession();
    const done = new Promise<ChatMessage>((resolve) => {
      const unsubscribe = chat.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done") {
          unsubscribe();
          resolve(event.message);
        }
      });
    });

    await chat.startMessage(
      session.sessionId,
      "podziel na mniejsze elementy",
      undefined,
      [{
        name: "codepack.zip",
        mimeType: "application/zip",
        size: 22,
        dataUrl: `data:application/zip;base64,${EMPTY_ZIP_BASE64}`
      }]
    );

    const assistant = await Promise.race([
      done,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SKILL_ROUTE_TIMEOUT")), 2000))
    ]);
    expect(calls).toHaveLength(1);
    expect(assistant.state).toBe("complete");
    expect(assistant.content).toContain("SKILLS_USED: codebase-inspection, planning");

    const persisted = await chat.getSession(session.sessionId);
    expect(persisted?.messages.at(-1)?.state).toBe("complete");
    expect(persisted?.messages.at(-1)?.content).toContain("Podział wykonany");
    expect(persisted?.messages.at(-2)?.attachments?.[0]?.mimeType).toBe("application/zip");
    chat.close();
  });
});
