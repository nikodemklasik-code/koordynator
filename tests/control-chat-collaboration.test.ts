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
    const request = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(request);
    if (request.stream === false) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "peer-ok" } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
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

async function sendAndWait(
  service: ChatService,
  sessionId: string,
  message: string,
  expectedAssistantDone = 1
): Promise<void> {
  const done = new Promise<void>((resolvePromise, reject) => {
    let completed = 0;
    const unsubscribe = service.subscribe(sessionId, (event) => {
      if (event.type === "assistant_done") {
        completed += 1;
        if (completed >= expectedAssistantDone) {
          unsubscribe();
          resolvePromise();
        }
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

    await sendAndWait(second, host.sessionId, "Continue using the invited chat.", 2);
    const latest = requestBodies.at(-1) as { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
    const systemText = (latest?.messages ?? [])
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => String(message.content))
      .join("\n");

    expect(systemText).toContain("COLLABORATING CHATS");
    expect(systemText).toContain("[CHAT: Frontend");
    expect(systemText).toContain("Keep the navigation inside Koordynator.");

    const shared = await second.getSession(host.sessionId);
    expect(shared?.messages.some((message) =>
      message.sourceSessionId === guest.sessionId &&
      message.agentTitle === "Frontend" &&
      message.content === "peer-ok" &&
      message.state === "complete"
    )).toBe(true);

    const summaries = await second.listSessions(100);
    expect(summaries.find((item) => item.sessionId === host.sessionId)).toMatchObject({
      title: "Main coordinator",
      invitedSessionIds: [guest.sessionId]
    });

    await second.deleteSession(guest.sessionId);
    expect(await second.getSession(guest.sessionId)).toBeNull();
    second.close();
  });

  it("allows more than eight invited agent chats and asks every invited participant to respond", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-many-agents-"));
    roots.push(root);
    const requestBodies: Array<Record<string, unknown>> = [];
    const service = new ChatService({
      stateDir: root,
      apiKey: "test",
      fetchImpl: streamingFetch(requestBodies)
    });

    const host = await service.createSession("auto/best-free");
    const guests = [];
    for (let index = 0; index < 12; index += 1) {
      const guest = await service.createSession("auto/best-free");
      await service.updateTitle(guest.sessionId, `Agent ${index + 1}`);
      await service.setInvitation(host.sessionId, guest.sessionId, true);
      guests.push(guest);
    }

    const configured = await service.getSession(host.sessionId);
    expect(configured?.invitedSessionIds).toHaveLength(12);

    await sendAndWait(service, host.sessionId, "Shared group question.", 13);

    const shared = await service.getSession(host.sessionId);
    const peerIds = new Set(
      shared?.messages
        .filter((message) => message.sourceSessionId && message.state === "complete")
        .map((message) => message.sourceSessionId)
    );
    expect(peerIds.size).toBe(12);
    for (const guest of guests) expect(peerIds.has(guest.sessionId)).toBe(true);

    service.close();
  });

});
