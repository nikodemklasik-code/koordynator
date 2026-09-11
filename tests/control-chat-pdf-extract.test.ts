import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService, type ChatEvent } from "../src/control/chat-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function streamingFetch(chunks = ["PDF_OK"]): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("Live Chat PDF attachment normalization", () => {
  it("converts PDF attachments to extracted text for upstream models that reject file parts", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-pdf-"));
    roots.push(root);
    let upstreamPayload: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      upstreamPayload = JSON.parse(String(init?.body ?? "{}")) as typeof upstreamPayload;
      return streamingFetch()(_input, init);
    }) as typeof fetch;
    const pdf = await readFile(resolve("tests/fixtures/hello-koordynator.pdf"));
    const service = new ChatService({ stateDir: root, apiKey: "super-secret-test-key", fetchImpl });
    const session = await service.createSession("gc/grok-4.5");
    const done = new Promise<void>((resolvePromise) => {
      service.subscribe(session.sessionId, (event: ChatEvent) => {
        if (event.type === "assistant_done" || event.type === "error") resolvePromise();
      });
    });
    await service.startMessage(session.sessionId, "Summarize attachment", undefined, [
      {
        name: "hello-koordynator.pdf",
        mimeType: "application/pdf",
        size: pdf.length,
        dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`
      }
    ]);
    await done;
    const user = (upstreamPayload?.messages || []).find((message) => message.role === "user");
    expect(Array.isArray(user?.content)).toBe(true);
    const parts = user?.content as Array<Record<string, unknown>>;
    expect(parts.some((part) => part.type === "file")).toBe(false);
    const blob = JSON.stringify(parts);
    expect(blob).toMatch(/Hello Koordynator/i);
    expect(blob).toContain("hello-koordynator.pdf");
    const restored = await service.getSession(session.sessionId);
    expect(restored?.messages[0]?.attachments?.[0]?.mimeType).toBe("application/pdf");
    service.close();
  });
});
