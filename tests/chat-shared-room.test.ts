import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ChatSession } from "../src/control/chat-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sourceSession(sessionId: string, model: string, title: string): ChatSession {
  return {
    sessionId,
    createdAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:01:00.000Z",
    model,
    messages: [
      {
        id: `${sessionId}-u`,
        sessionId,
        role: "user",
        content: title,
        createdAt: "2026-09-21T10:00:00.000Z",
        state: "complete"
      },
      {
        id: `${sessionId}-a`,
        sessionId,
        role: "assistant",
        content: `Source answer for ${title}`,
        createdAt: "2026-09-21T10:00:30.000Z",
        completedAt: "2026-09-21T10:01:00.000Z",
        state: "complete",
        model
      }
    ]
  };
}

async function seed(root: string, session: ChatSession) {
  const dir = join(root, "chat");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.sessionId}.json`), JSON.stringify(session, null, 2), "utf8");
}

describe("Shared Room", () => {
  it("keeps two source agents distinct and lets the second see the first agent's room response", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-shared-room-"));
    roots.push(root);

    const s1 = "11111111-1111-4111-8111-111111111111";
    const s2 = "22222222-2222-4222-8222-222222222222";
    await seed(root, sourceSession(s1, "cx/frontend-model", "Build the WWW frontend"));
    await seed(root, sourceSession(s2, "cc/brand-model", "Define brand/content for the WWW"));

    const bodies: Array<{ model?: string; messages?: Array<{ role: string; content: string }> }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      const delta = `Response from ${body.model}`;
      const stream = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}`,
        "data: [DONE]",
        ""
      ].join("\n\n");
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": `req-${bodies.length}` }
      });
    }) as typeof fetch;

    const chat = new ChatService({ stateDir: root, apiKey: "test", fetchImpl });
    const room = await chat.createSharedRoom("WWW / frontend", [
      { sourceSessionId: s1, role: "FRONTEND_DEVELOPER" },
      { sourceSessionId: s2, role: "RESEARCHER" }
    ]);

    expect(room.sharedRoom?.participants).toHaveLength(2);
    expect(room.sharedRoom?.participants.map((p) => p.model)).toEqual(["cx/frontend-model", "cc/brand-model"]);
    expect(room.sharedRoom?.rounds).toBe(3);

    const done = new Promise<void>((resolve) => {
      const unsubscribe = chat.subscribe(room.sessionId, (event) => {
        if (event.type === "process_update" && event.update.agent === "Shared Room" && event.update.stage === "DONE") {
          unsubscribe();
          resolve();
        }
      });
    });

    await chat.startSharedMessage(room.sessionId, "Agree the shared interface contract.");
    await done;

    const stored = await chat.getSession(room.sessionId);
    expect(stored).not.toBeNull();
    const assistants = stored!.messages.filter((message) => message.role === "assistant");
    expect(assistants).toHaveLength(6);
    expect(assistants.map((message) => message.agentLabel)).toEqual([
      "Build the WWW frontend",
      "Define brand/content for the WWW",
      "Build the WWW frontend",
      "Define brand/content for the WWW",
      "Build the WWW frontend",
      "Define brand/content for the WWW"
    ]);
    expect(assistants.map((message) => message.sourceSessionId)).toEqual([s1, s2, s1, s2, s1, s2]);
    expect(assistants.map((message) => message.model)).toEqual([
      "cx/frontend-model", "cc/brand-model",
      "cx/frontend-model", "cc/brand-model",
      "cx/frontend-model", "cc/brand-model"
    ]);
    expect(assistants.every((message) => message.state === "complete")).toBe(true);

    expect(bodies).toHaveLength(6);
    expect(bodies.map((body) => body.model)).toEqual([
      "cx/frontend-model", "cc/brand-model",
      "cx/frontend-model", "cc/brand-model",
      "cx/frontend-model", "cc/brand-model"
    ]);
    expect(bodies.every((body) => (body as { max_tokens?: number }).max_tokens === 32_768)).toBe(true);
    const secondPrompt = bodies[1]?.messages?.map((message) => message.content).join("\n") || "";
    const thirdPrompt = bodies[2]?.messages?.map((message) => message.content).join("\n") || "";
    expect(secondPrompt).toContain("Response from cx/frontend-model");
    expect(secondPrompt).toContain("SHARED TOPIC: WWW / frontend");
    expect(thirdPrompt).toContain("DISCUSSION ROUND: 2 of 3");
    expect(thirdPrompt).toContain("Response from cc/brand-model");

    const summary = (await chat.listSessions(10)).find((item) => item.sessionId === room.sessionId);
    expect(summary).toMatchObject({
      sharedRoom: true,
      participantCount: 2,
      topic: "WWW / frontend"
    });

    chat.close();
  });

  it("preserves user-selected participant order and bounded round count", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-shared-order-"));
    roots.push(root);
    const s1 = "33333333-3333-4333-8333-333333333333";
    const s2 = "44444444-4444-4444-8444-444444444444";
    await seed(root, sourceSession(s1, "cx/first-model", "First source"));
    await seed(root, sourceSession(s2, "cc/second-model", "Second source"));
    const bodies: Array<{ model?: string; messages?: Array<{ content: string }> }> = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      const stream = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Response from ${body.model}` } }] })}`,
        "data: [DONE]",
        ""
      ].join("\n\n");
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const chat = new ChatService({ stateDir: root, apiKey: "test", fetchImpl });
    const room = await chat.createSharedRoom("Architecture", [
      { sourceSessionId: s2, role: "RESEARCHER" },
      { sourceSessionId: s1, role: "DEVELOPER" }
    ], 2);
    expect(room.sharedRoom?.participants.map((p) => p.sourceSessionId)).toEqual([s2, s1]);
    expect(room.sharedRoom?.rounds).toBe(2);

    const done = new Promise<void>((resolve) => {
      const unsubscribe = chat.subscribe(room.sessionId, (event) => {
        if (event.type === "process_update" && event.update.agent === "Shared Room" && event.update.stage === "DONE") {
          unsubscribe();
          resolve();
        }
      });
    });
    await chat.startSharedMessage(room.sessionId, "Discuss this topic.");
    await done;

    expect(bodies.map((body) => body.model)).toEqual([
      "cc/second-model", "cx/first-model",
      "cc/second-model", "cx/first-model"
    ]);
    chat.close();
  });

  it("ships the Shared Room controls and preserves per-agent model semantics in UI", async () => {
    const [html, js, chatJs, server, css] = await Promise.all([
      readFile(new URL("../web/control/chat.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shared-room.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat.js", import.meta.url), "utf8"),
      readFile(new URL("../src/control/server.ts", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-v5.css", import.meta.url), "utf8")
    ]);

    expect(html).toContain('id="addAgentButton"');
    expect(html).toContain("Zaproś 2. czat");
    expect(html).toContain('id="sharedRoomDialog"');
    expect(html).toContain('id="sharedRoomStarter"');
    expect(html).toContain('id="sharedRoomRounds"');
    expect(html).toContain('id="sharedRoomTopicLabel"');
    expect(html).toContain("WSPÓLNY TEMAT / ELEMENT PROJEKTU");
    expect(html).toContain('placeholder="np. WWW / frontend"');
    expect(html).toContain('/chat-shared-room.js?v=4');
    expect(js).toContain('fetch("/api/chat/shared-rooms"');
    expect(js).toContain('starterSelect?.value === "second"');
    expect(js).toContain("rounds,");
    expect(js).toContain("thread.prepend(bar)");
    expect(js).toContain('topicInput?.scrollIntoView');
    expect(js).toContain('topicInput?.classList.add("invalid")');
    expect(js).toContain("Shared Room · per-agent models");
    expect(chatJs).toContain('message.agentLabel || "KOORDYNATOR"');
    expect(server).toContain('pathname === "/api/chat/shared-rooms"');
    expect(server).toContain('"/chat-shared-room.js"');
    expect(css).toContain(".shared-room-participant");
    expect(css).toContain(".v5-agent-button");
    expect(css).toContain(".shared-room-topic-step");
    expect(css).toContain("position:sticky!important");
    expect(css).toContain("#sharedRoomTopic.invalid");
  });
});
