import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateChatBilling } from "../src/control/chat-billing-policy.js";
import type { ChatModelBillingSource, ChatModelCatalog, ChatModelCatalogPort } from "../src/control/chat-model-catalog.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function catalogWith(source: ChatModelBillingSource, model = "auto/best-free"): ChatModelCatalog {
  return {
    models: [model],
    source: "OMNIROUTE",
    checkedAt: "2026-09-10T15:00:00.000Z",
    billing: {
      liveChatTransport: "OMNIROUTE_API",
      subscriptionHarnessUsed: false,
      subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
      modelSources: { [model]: source }
    }
  };
}

function usageStreamingFetch(counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls += 1;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "done" } }] })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req-billing-1" } });
  }) as typeof fetch;
}

async function waitForComplete(base: string, sessionId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = await fetch(`${base}/api/chat/sessions/${sessionId}`).then((response) => response.json()) as { messages?: Array<Record<string, unknown>> };
    const assistant = session.messages?.find((message) => message.role === "assistant");
    if (assistant?.state === "complete") return assistant;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
  }
  throw new Error("CHAT_BILLING_TEST_TIMEOUT");
}

describe("Live Chat strict billing provenance", () => {
  it("allows only confirmed-free billing by default", () => {
    expect(evaluateChatBilling("m", catalogWith("FREE_CONFIRMED", "m")).allowed).toBe(true);
    expect(evaluateChatBilling("m", catalogWith("FREE_REQUESTED", "m")).decision).toBe("BLOCK_FREE_UNCONFIRMED");
    expect(evaluateChatBilling("m", catalogWith("PAID_API", "m")).decision).toBe("BLOCK_PAID_API");
    expect(evaluateChatBilling("m", catalogWith("UNKNOWN", "m")).decision).toBe("BLOCK_UNKNOWN");
  });

  it("blocks unconfirmed free before upstream execution, then persists provider-reported usage for confirmed free", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-billing-"));
    roots.push(root);
    const counter = { calls: 0 };
    let billingSource: ChatModelBillingSource = "FREE_REQUESTED";
    const modelCatalog: ChatModelCatalogPort = {
      async list() { return catalogWith(billingSource); }
    };
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "server-secret",
      chatFetchImpl: usageStreamingFetch(counter),
      chatModelCatalog: modelCatalog
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CHAT_BILLING_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;
      const created = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto/best-free" })
      });
      const session = await created.json() as { sessionId: string };

      const blocked = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "must not spend" })
      });
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toEqual({ error: "CHAT_BILLING_FREE_UNCONFIRMED" });
      expect(counter.calls).toBe(0);

      billingSource = "FREE_CONFIRMED";
      const accepted = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "confirmed free" })
      });
      expect(accepted.status).toBe(202);
      const acceptedPayload = await accepted.json() as { billingSource: string };
      expect(acceptedPayload.billingSource).toBe("FREE_CONFIRMED");
      expect(counter.calls).toBe(1);

      const assistant = await waitForComplete(base, session.sessionId);
      expect(assistant.providerRequestId).toBe("req-billing-1");
      expect(assistant.billing).toMatchObject({ source: "FREE_CONFIRMED", allowed: true, decision: "ALLOW_FREE_CONFIRMED" });
      expect(assistant.usage).toEqual({ reportedBy: "PROVIDER", inputTokens: 12, outputTokens: 7, totalTokens: 19 });
      expect(assistant.usageAudit).toBe("PERSISTED");

      const summary = await fetch(`${base}/api/chat/usage?hours=24`).then((response) => response.json()) as {
        tokenTelemetryReported: number;
        totalTokens: number;
        bySource: Record<string, { requests: number; totalTokens: number }>;
      };
      expect(summary.tokenTelemetryReported).toBe(1);
      expect(summary.totalTokens).toBe(19);
      expect(summary.bySource.FREE_CONFIRMED).toMatchObject({ requests: 1, totalTokens: 19 });
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
