import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ChatEvent } from "../src/control/chat-service.js";
import type { ChatModelCatalogPort } from "../src/control/chat-model-catalog.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  const pending = roots.splice(0);
  for (const root of pending) {
    let lastError = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    if (lastError) throw lastError;
  }
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

function confirmedFreeCatalog(model = "openai/gpt-5.6-sol"): ChatModelCatalogPort {
  return {
    async list() {
      return {
        models: [model],
        source: "OMNIROUTE",
        checkedAt: "2026-09-10T15:00:00.000Z",
        billing: {
          liveChatTransport: "OMNIROUTE_API",
          subscriptionHarnessUsed: false,
          subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
          modelSources: { [model]: "FREE_CONFIRMED" as const }
        }
      };
    }
  };
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

  it("injects project context as a system message without persisting it in the transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-context-"));
    roots.push(root);
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return streamingFetch(["OK"])(_input, init);
    }) as typeof fetch;
    const service = new ChatService({
      stateDir: root,
      apiKey: "super-secret-test-key",
      fetchImpl,
      projectContextProvider: async () => "PROJECT_CONTRACT_CONTEXT"
    });
    const session = await service.createSession("openai/gpt-5.6-sol");
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done") resolvePromise();
      });
    });
    await service.startMessage(session.sessionId, "Use project rules");
    await done;
    const upstream = capturedBody as { messages?: Array<{ role: string; content: unknown }> } | null;
    expect(upstream?.messages?.[0]).toMatchObject({ role: "system", content: "PROJECT_CONTRACT_CONTEXT" });
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(restored?.messages[0]?.content).toBe("Use project rules");
    service.close();
  });

  it("forwards detected images and extracted document text and persists attachment metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-attachments-"));
    roots.push(root);
    let upstreamPayload: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      upstreamPayload = JSON.parse(String(init?.body ?? "{}")) as typeof upstreamPayload;
      return streamingFetch(["seen"])(input, init);
    }) as typeof fetch;
    const service = new ChatService({ stateDir: root, apiKey: "secret", fetchImpl });
    const session = await service.createSession();
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done") resolvePromise();
      });
    });

    await service.startMessage(session.sessionId, "Review these", undefined, [
      { name: "photo.png", mimeType: "image/png", size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      { name: "brief.pdf", mimeType: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,Yg==" }
    ]);
    await done;

    const user = (upstreamPayload?.messages || []).find((message) => message.role === "user");
    expect(user?.role).toBe("user");
    expect(user?.content).toEqual([
      { type: "text", text: "Review these" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      { type: "text", text: "[Attachment: brief.pdf; EXTRACTED]\nb" }
    ]);
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages[0]?.attachments?.map((attachment) => [attachment.name, attachment.mimeType, attachment.size])).toEqual([
      ["photo.png", "image/png", 8],
      ["brief.pdf", "text/plain", 1]
    ]);
    service.close();
  });

  it("rejects invalid MIME metadata and oversized attachments before contacting the model", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-attachments-"));
    roots.push(root);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return streamingFetch(["unexpected"])("http://test");
    }) as typeof fetch;
    const service = new ChatService({ stateDir: root, apiKey: "secret", fetchImpl, maxAttachmentBytes: 1 });
    const session = await service.createSession();

    await expect(service.startMessage(session.sessionId, "", undefined, [
      { name: "script.sh", mimeType: "invalid", size: 1, dataUrl: "data:application/x-sh;base64,YQ==" }
    ])).rejects.toThrow("CHAT_ATTACHMENTS_INVALID");
    await expect(service.startMessage(session.sessionId, "", undefined, [
      { name: "photo.png", mimeType: "image/png", size: 2, dataUrl: "data:image/png;base64,YWI=" }
    ])).rejects.toThrow("CHAT_ATTACHMENT_TOO_LARGE");
    expect(calls).toBe(0);
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
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done" || event.type === "stopped" || event.type === "error") resolvePromise();
      });
    });
    await service.startMessage(session.sessionId, "first");
    await expect(service.startMessage(session.sessionId, "second")).rejects.toThrow("CHAT_GENERATION_IN_PROGRESS");
    release();
    await done;
    service.close();
  });

  it("skips a 429 model and continues on the next fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-fallback-"));
    roots.push(root);
    const models: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
      models.push(String(body.model || ""));
      if (body.model === "cc/claude-opus-5") {
        return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
      }
      return streamingFetch(["ok-from-grok"])(_input, init);
    }) as typeof fetch;
    const service = new ChatService({
      stateDir: root,
      apiKey: "super-secret-test-key",
      defaultModel: "cc/claude-opus-5",
      fallbackModels: ["gc/grok-4.6"],
      fetchImpl
    });
    const session = await service.createSession("cc/claude-opus-5");
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done" || event.type === "error") resolvePromise();
      });
    });
    await service.startMessage(session.sessionId, "ping");
    await done;
    expect(models).toEqual(["cc/claude-opus-5", "gc/grok-4.6"]);
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages.at(-1)?.state).toBe("complete");
    expect(restored?.messages.at(-1)?.content).toBe("ok-from-grok");
    expect(restored?.messages.at(-1)?.model).toBe("gc/grok-4.6");
    service.close();
  });

  it("skips a 503 model and continues on the next fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-503-"));
    roots.push(root);
    const models: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
      models.push(String(body.model || ""));
      if (body.model === "cc/claude-opus-5") {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
      }
      return streamingFetch(["ok-from-grok"])(_input, init);
    }) as typeof fetch;
    const service = new ChatService({
      stateDir: root,
      apiKey: "super-secret-test-key",
      defaultModel: "cc/claude-opus-5",
      fallbackModels: ["gc/grok-4.6"],
      fetchImpl
    });
    const session = await service.createSession("cc/claude-opus-5");
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event) => {
        if (event.type === "assistant_done" || event.type === "error") resolvePromise();
      });
    });
    await service.startMessage(session.sessionId, "ping");
    await done;
    expect(models).toEqual(["cc/claude-opus-5", "gc/grok-4.6"]);
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages.at(-1)?.state).toBe("complete");
    expect(restored?.messages.at(-1)?.content).toBe("ok-from-grok");
    expect(restored?.messages.at(-1)?.model).toBe("gc/grok-4.6");
    service.close();
  });
});

describe("Live Chat HTTP boundary and UI", () => {
  it("serves a functional chat screen, accepts attachments, scopes POST to chat endpoints and keeps secrets server-side", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-http-"));
    roots.push(root);
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "browser-must-never-see-this",
      chatFetchImpl: streamingFetch(),
      chatModelCatalog: confirmedFreeCatalog()
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
      expect(page).toContain('id="attachButton"');
      expect(page).toContain('id="fileInput"');
      expect(page).toContain('id="chatFrame"');
      expect(page).toContain('id="chatDropOverlay"');
      expect(page).toContain('id="popoutChatButton"');
      expect(page).toContain('id="stageZeroButton"');
      expect(page).toContain('id="exportMdButton"');
      expect(page).toContain('id="exportPdfButton"');
      expect(page).toContain('id="exportZipButton"');
      expect(page).toContain("Drop files or a GitHub repo link here");
      expect(page).toContain("githubChatConsentDialog");
      expect(page).not.toContain("browser-must-never-see-this");
      expect(page.toLowerCase()).not.toContain("deepseek");
      const css = await fetch(`${base}/chat.css`).then((response) => response.text());
      expect(css).toContain(".chat-frame.drag-active");
      expect(css).toContain(".chat-drop-overlay");
      expect(css).toContain(".chat-action-button");
      const ui = await fetch(`${base}/control-ui.css`).then((response) => response.text());
      expect(ui).toContain("position:sticky");
      expect(ui).toContain("height:100vh");
      const js = await fetch(`${base}/chat.js`).then((response) => response.text());
      expect(js).toContain("handleDroppedPayload");
      expect(js).toContain("TEXTUAL_EXTENSIONS");
      expect(js).toContain("extractGithubUrls");
      expect(js).toContain("createCopyButton");
      expect(js).toContain("Copy code");
      expect(js).toContain("Copy message");
      expect(js).toContain("openPopoutChat");
      expect(js).toContain("exportConversation");
      expect(js).toContain("buildMarkdownExport");
      expect(js).toContain("buildPdfExport");
      expect(js).toContain("buildZipExport");
      expect(js).toContain("URLSearchParams");
      expect(css).toContain(".code-copy");
      expect(css).toContain(".message-copy");
      expect(ui).toContain("grid-template-rows:52px minmax(0,1fr)");
      expect(await fetch(`${base}/control-ui.css`).then((response) => response.status)).toBe(200);
      expect(await fetch(`${base}/chat-usage.css`).then((response) => response.status)).toBe(200);
      expect(await fetch(`${base}/chat-usage.js`).then((response) => response.status)).toBe(200);

      const created = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5.6-sol" })
      });
      expect(created.status).toBe(201);
      const session = await created.json() as { sessionId: string };

      const attached = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "",
          model: "openai/gpt-5.6-sol",
          attachments: [{ name: "note.txt", mimeType: "text/plain", size: 1, dataUrl: "data:text/plain;base64,YQ==" }]
        })
      });
      expect(attached.status).toBe(202);

      const other = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const otherSession = await other.json() as { sessionId: string };
      const unknown = await fetch(`${base}/api/chat/sessions/${otherSession.sessionId}/messages`, {
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
});
