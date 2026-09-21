import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatService } from "../src/control/chat-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function streamingFetch(bodies: Array<Record<string, unknown>>): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

async function sendAndWait(service: ChatService, sessionId: string, message: string): Promise<void> {
  const done = new Promise<void>((resolvePromise, reject) => {
    const unsubscribe = service.subscribe(sessionId, (event) => {
      if (event.type === "assistant_done") {
        unsubscribe();
        resolvePromise();
      }
      if (event.type === "error") {
        unsubscribe();
        reject(new Error(event.code));
      }
    });
  });
  await service.startMessage(sessionId, message);
  await done;
}

describe("persistent chat collaboration", () => {
  it("persists titles and invited chats, injects peer context, and deletes chats", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-collab-"));
    roots.push(root);
    const requestBodies: Array<Record<string, unknown>> = [];

    const first = new ChatService({
      stateDir: root,
      apiKey: "test",
      fetchImpl: streamingFetch(requestBodies)
    });

    const guest = await first.createSession("auto/best-free");
    await first.updateTitle(guest.sessionId, "Frontend");
    await sendAndWait(first, guest.sessionId, "Keep the navigation inside Koordynator.");

    const host = await first.createSession("auto/best-free");
    await first.updateTitle(host.sessionId, "Main coordinator");
    await first.setInvitation(host.sessionId, guest.sessionId, true);

    const beforeRestart = await first.getSession(host.sessionId);
    expect(beforeRestart?.title).toBe("Main coordinator");
    expect(beforeRestart?.invitedSessionIds).toEqual([guest.sessionId]);
    first.close();

    const second = new ChatService({
      stateDir: root,
      apiKey: "test",
      fetchImpl: streamingFetch(requestBodies)
    });

    const restored = await second.getSession(host.sessionId);
    expect(restored?.title).toBe("Main coordinator");
    expect(restored?.invitedSessionIds).toEqual([guest.sessionId]);

    await sendAndWait(second, host.sessionId, "Continue using the invited chat.");
    const latest = requestBodies.at(-1) as { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
    const systemText = (latest?.messages ?? [])
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => String(message.content))
      .join("\n");

    expect(systemText).toContain("COLLABORATING CHATS");
    expect(systemText).toContain("[CHAT: Frontend");
    expect(systemText).toContain("Keep the navigation inside Koordynator.");

    const summaries = await second.listSessions(100);
    expect(summaries.find((item) => item.sessionId === host.sessionId)).toMatchObject({
      title: "Main coordinator",
      invitedSessionIds: [guest.sessionId]
    });

    await second.deleteSession(guest.sessionId);
    expect(await second.getSession(guest.sessionId)).toBeNull();
    second.close();
  });
});
