import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "../src/control/chat-service.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function streamingFetch(reply: string): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

async function sendAndWait(service: ChatService, sessionId: string, message: string): Promise<void> {
  const done = new Promise<void>((resolvePromise) => {
    const unsubscribe = service.subscribe(sessionId, (event) => {
      if (event.type === "assistant_done") {
        unsubscribe();
        resolvePromise();
      }
    });
  });
  await service.startMessage(sessionId, message);
  await done;
}

describe("persistent Live Chat history", () => {
  it("lists persisted sessions newest first with stable titles and serves the history client", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-history-"));
    roots.push(root);
    const service = new ChatService({ stateDir: root, apiKey: "test", fetchImpl: streamingFetch("ok") });

    const first = await service.createSession("openai/gpt-5.6-sol");
    await sendAndWait(service, first.sessionId, "First persistent conversation");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    const second = await service.createSession("anthropic/claude-sonnet-5");
    await sendAndWait(service, second.sessionId, "Second persistent conversation");

    const direct = await service.listSessions(100);
    expect(direct.map((item) => item.sessionId)).toEqual([second.sessionId, first.sessionId]);
    expect(direct.map((item) => item.title)).toEqual(["Second persistent conversation", "First persistent conversation"]);
    expect(direct.map((item) => item.messageCount)).toEqual([2, 2]);
    service.close();

    const server = createControlServer({ stateDir: root, webRoot: resolve("web/control") });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CHAT_HISTORY_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${base}/api/chat/sessions?limit=100`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { sessions: Array<{ sessionId: string; title: string }> };
      expect(payload.sessions.map((item) => item.sessionId)).toEqual([second.sessionId, first.sessionId]);
      expect(payload.sessions[0]?.title).toBe("Second persistent conversation");

      const page = await fetch(`${base}/chat`).then((item) => item.text());
      expect(page).toContain('id="historyButton"');
      expect(page).toContain('id="historyPanel"');
      expect(page).toContain('/chat-history.js');

      const historyScript = await fetch(`${base}/chat-history.js`);
      expect(historyScript.status).toBe(200);
      expect(await historyScript.text()).toContain("/api/chat/sessions?limit=100");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
