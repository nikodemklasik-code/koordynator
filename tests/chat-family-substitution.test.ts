import { describe, expect, it } from "vitest";
import { ChatService } from "../src/control/chat-service.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function drain(service: ChatService, sessionId: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const session = await service.getSession(sessionId);
    const assistant = session?.messages.at(-1);
    if (assistant && assistant.state !== "streaming") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("assistant never settled");
}

describe("family route substitution", () => {
  it("substitutes the same model across providers when the free one fails", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "family-chat-"));
    try {
      const attempted: string[] = [];
      const service = new ChatService({
        stateDir,
        apiKey: "test-key",
        defaultModel: "family/claude-opus-4.8",
        familyCandidates: (model) => model === "family/claude-opus-4.8"
          ? ["llm7/claude-opus-4.8", "cc/claude-opus-4-8", "openrouter/anthropic/claude-opus-4.8"]
          : [],
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          attempted.push(body.model);
          if (body.model === "llm7/claude-opus-4.8") return new Response("{}", { status: 429 });
          return sse("ok");
        }) as unknown as typeof fetch
      });

      const session = await service.createSession();
      expect(session.model).toBe("family/claude-opus-4.8");
      await service.startMessage(session.sessionId, "hi");
      await drain(service, session.sessionId);

      // The family never reaches the gateway; only concrete routes do.
      expect(attempted).toEqual(["llm7/claude-opus-4.8", "cc/claude-opus-4-8"]);
      const stored = await service.getSession(session.sessionId);
      expect(stored?.messages.at(-1)?.state).toBe("complete");
      expect(stored?.messages.at(-1)?.model).toBe("cc/claude-opus-4-8");
      // The session keeps the family so the next turn re-resolves it live.
      expect(stored?.model).toBe("family/claude-opus-4.8");
      service.close();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("continues to the next concrete route when a family provider rejects the model with 400", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "family-chat-"));
    try {
      const attempted: string[] = [];
      const service = new ChatService({
        stateDir,
        apiKey: "test-key",
        defaultModel: "family/grok-4.6",
        familyCandidates: () => ["gh/grok-4.6", "gc/grok-4.6"],
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          const model = JSON.parse(String(init?.body ?? "{}")).model;
          attempted.push(model);
          if (model === "gh/grok-4.6") return new Response('{"error":"unsupported"}', { status: 400 });
          return sse("TEST_OK");
        }) as unknown as typeof fetch
      });

      const session = await service.createSession();
      await service.startMessage(session.sessionId, "hi");
      await drain(service, session.sessionId);

      expect(attempted).toEqual(["gh/grok-4.6", "gc/grok-4.6"]);
      const stored = await service.getSession(session.sessionId);
      expect(stored?.messages.at(-1)).toMatchObject({ state: "complete", content: "TEST_OK", model: "gc/grok-4.6" });
      service.close();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("leaves a concrete model id untouched", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "family-chat-"));
    try {
      const attempted: string[] = [];
      const service = new ChatService({
        stateDir,
        apiKey: "test-key",
        defaultModel: "gc/grok-4.6",
        familyCandidates: () => [],
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          attempted.push(JSON.parse(String(init?.body ?? "{}")).model);
          return sse("ok");
        }) as unknown as typeof fetch
      });
      const session = await service.createSession();
      await service.startMessage(session.sessionId, "hi");
      await drain(service, session.sessionId);
      expect(attempted).toEqual(["gc/grok-4.6"]);
      service.close();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("skips a Copilot tool dump and continues to the native grok route", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "family-chat-"));
    try {
      const attempted: string[] = [];
      const service = new ChatService({
        stateDir,
        apiKey: "k",
        defaultModel: "family/grok-4.6",
        familyCandidates: () => ["gh/grok-4.6", "gc/grok-4.6"],
        fetchImpl: (async (_url: string, init?: RequestInit) => {
          const model = JSON.parse(String(init?.body ?? "{}")).model;
          attempted.push(model);
          if (model === "gh/grok-4.6") return sse("Najpierw sprawdzę.0emod_zenithcall_mcp_toolcall_search_files_with_regex");
          return sse("TEST_OK");
        }) as unknown as typeof fetch
      });
      const session = await service.createSession();
      await service.startMessage(session.sessionId, "hi");
      await drain(service, session.sessionId);
      expect(attempted).toEqual(["gh/grok-4.6", "gc/grok-4.6"]);
      const stored = await service.getSession(session.sessionId);
      expect(stored?.messages.at(-1)).toMatchObject({ state: "complete", content: "TEST_OK", model: "gc/grok-4.6" });
      service.close();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
