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


  it("allows more than eight invited participants and lets every active participant respond", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-many-"));
    roots.push(root);
    const requestBodies: Array<Record<string, unknown>> = [];

    const service = new ChatService({
      stateDir: root,
      apiKey: "test",
      fetchImpl: streamingFetch(requestBodies)
    });

    const guests = [];
    for (let index = 0; index < 12; index += 1) {
      const guest = await service.createSession("auto/best-free");
      await service.updateTitle(guest.sessionId, `Agent ${String(index + 1).padStart(2, "0")}`);
      await sendAndWait(service, guest.sessionId, `Private source context for agent ${index + 1}.`);
      guests.push(guest);
    }

    const host = await service.createSession("auto/best-free");
    await service.updateTitle(host.sessionId, "Large group");

    for (const guest of guests) {
      await service.setInvitation(host.sessionId, guest.sessionId, true);
    }

    const configured = await service.getSession(host.sessionId);
    expect(configured?.invitedSessionIds).toHaveLength(12);

    await sendAndWait(service, host.sessionId, "Discuss this as the whole group.", 13);

    const completed = await service.getSession(host.sessionId);
    const peerMessages = completed?.messages.filter((message) =>
      message.role === "assistant"
      && message.state === "complete"
      && typeof message.sourceSessionId === "string"
    ) ?? [];

    expect(peerMessages).toHaveLength(12);
    expect(new Set(peerMessages.map((message) => message.sourceSessionId))).toEqual(
      new Set(guests.map((guest) => guest.sessionId))
    );
    expect(peerMessages.map((message) => message.groupTurnReceipt?.turn)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
    expect(peerMessages[0]?.groupTurnReceipt?.previousTurnReceiptHash).toBeNull();
    for (let index = 1; index < peerMessages.length; index += 1) {
      expect(peerMessages[index]?.groupTurnReceipt?.previousTurnReceiptHash)
        .toBe(peerMessages[index - 1]?.groupTurnReceipt?.turnReceiptHash);
    }

    const mainRequest = [...requestBodies].reverse().find((request) => request.stream === true) as
      | { messages?: Array<{ role?: string; content?: unknown }> }
      | undefined;
    const systemText = (mainRequest?.messages ?? [])
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => String(message.content))
      .join("\n");

    expect(systemText).toContain("12 peer chat(s) are explicitly invited");
    expect(systemText).toContain("[CHAT: Agent 01");
    expect(systemText).toContain("[CHAT: Agent 12");

    service.close();
  });



  it("persists participant roles and prevents observers or shared-only peers from receiving source-chat authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-contract-"));
    roots.push(root);
    const requestBodies: Array<Record<string, unknown>> = [];

    const service = new ChatService({
      stateDir: root,
      apiKey: "test",
      fetchImpl: streamingFetch(requestBodies)
    });

    const observer = await service.createSession("auto/best-free");
    await service.updateTitle(observer.sessionId, "Observer");
    await sendAndWait(service, observer.sessionId, "observer-private-source");

    const contributor = await service.createSession("auto/best-free");
    await service.updateTitle(contributor.sessionId, "Contributor");
    await sendAndWait(service, contributor.sessionId, "contributor-private-source");

    const host = await service.createSession("auto/best-free");
    await service.setInvitation(host.sessionId, observer.sessionId, true);
    await service.setInvitation(host.sessionId, contributor.sessionId, true);

    await service.setParticipantBinding(host.sessionId, observer.sessionId, {
      participationRole: "OBSERVER"
    });
    await service.setParticipantBinding(host.sessionId, contributor.sessionId, {
      knowledgeMode: "SHARED_ONLY"
    });

    const configured = await service.getSession(host.sessionId);
    expect(configured?.participants?.find((item) => item.sessionId === observer.sessionId)).toMatchObject({
      participationRole: "OBSERVER",
      canRespond: false
    });
    expect(configured?.participants?.find((item) => item.sessionId === contributor.sessionId)).toMatchObject({
      knowledgeMode: "SHARED_ONLY",
      canRespond: true
    });

    await sendAndWait(service, host.sessionId, "Only active speaking participants should respond.", 2);

    const completed = await service.getSession(host.sessionId);
    expect(completed?.messages.some((message) => message.sourceSessionId === observer.sessionId)).toBe(false);
    expect(completed?.messages.some((message) => message.sourceSessionId === contributor.sessionId)).toBe(true);

    const contributorCall = [...requestBodies].reverse().find((request) => {
      if (request.stream !== false || !Array.isArray(request.messages)) return false;
      return request.messages.some((message) =>
        typeof message === "object"
        && message !== null
        && typeof (message as { content?: unknown }).content === "string"
        && String((message as { content: string }).content).includes('You are the invited chat participant "Contributor"')
      );
    }) as { messages?: Array<{ content?: unknown }> } | undefined;

    const contributorContext = (contributorCall?.messages ?? [])
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");

    expect(contributorContext).not.toContain("contributor-private-source");
    service.close();
  });

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
});
