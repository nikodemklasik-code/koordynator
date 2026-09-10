import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ChatEvent } from "../src/control/chat-service.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function streamingFetch(chunks = ["Hel", "lo"]): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req-test-1" } });
  }) as typeof fetch;
}

describe("Live Chat service", () => {
  it("emits incremental assistant deltas, persists the transcript and never stores the API key", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-"));
    roots.push(root);
    const service = new ChatService({ stateDir: root, apiKey: "super-secret-test-key", fetchImpl: streamingFetch() });
    const session = await service.createSession("openai/gpt-5.6-sol");
    const events: ChatEvent[] = [];
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        events.push(event);
        if (event.type === "assistant_done") resolvePromise();
      });
    });

    await service.startMessage(session.sessionId, "Say hello");
    await done;

    expect(events.filter((event) => event.type === "assistant_delta")).toHaveLength(2);
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages.map((message) => [message.role, message.content, message.state])).toEqual([
      ["user", "Say hello", "complete"],
      ["assistant", "Hello", "complete"]
    ]);
    const disk = await readFile(join(root, "chat", `${session.sessionId}.json`), "utf8");
    expect(disk).not.toContain("super-secret-test-key");
    expect(disk).not.toContain("Authorization");
    service.close();
  });

  it("blocks DeepSeek and rejects a second generation while one is active", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-"));
    roots.push(root);
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const fetchImpl = (async () => {
      await gate;
      return streamingFetch(["done"])("http://test");
    }) as typeof fetch;
    const service = new ChatService({ stateDir: root, apiKey: "secret", fetchImpl });
    await expect(service.createSession("deepseek/anything")).rejects.toThrow("CHAT_MODEL_FORBIDDEN");
    const session = await service.createSession();
    await service.startMessage(session.sessionId, "first");
    await expect(service.startMessage(session.sessionId, "second")).rejects.toThrow("CHAT_GENERATION_IN_PROGRESS");
    release();
    service.close();
  });
});

describe("Live Chat HTTP boundary and UI", () => {
  it("serves a functional chat screen, scopes POST to chat endpoints and keeps secrets server-side", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-http-"));
    roots.push(root);
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "browser-must-never-see-this",
      chatFetchImpl: streamingFetch()
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CHAT_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const page = await fetch(`${base}/chat`).then((response) => response.text());
      expect(page).toContain("Live Chat");
      expect(page).toContain('id="sendButton"');
      expect(page).toContain('id="stopButton"');
      expect(page).toContain('id="newChatButton"');
      expect(page).not.toContain("browser-must-never-see-this");
      expect(page.toLowerCase()).not.toContain("deepseek");
      expect(await fetch(`${base}/control-ui.css`).then((response) => response.status)).toBe(200);

      const created = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5.6-sol" })
      });
      expect(created.status).toBe(201);
      const session = await created.json() as { sessionId: string };

      const unknown = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello", extra: true })
      });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: "CHAT_UNKNOWN_FIELD" });

      const denied = await fetch(`${base}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(denied.status).toBe(405);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
