import { afterEach, describe, expect, it } from "vitest";
import { mintTaskTicket } from "../src/security/task-ticket.js";
import { startTicketProxy, type TicketProxy } from "../src/security/ticket-proxy.js";

const proxies: TicketProxy[] = [];
afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
});

describe("Ticket proxy (worker never holds the gateway key)", () => {
  it("blocks paid fallback models and alternate endpoints before calling upstream", async () => {
    let calls = 0;
    const proxy = await startTicketProxy({ upstream: "http://gateway/v1", apiKey: "secret", secret: "broker",
      authorizeModel: async model => model === "oc/free",
      fetchImpl: (async () => { calls++; return Response.json({ ok: true }); }) as typeof fetch });
    proxies.push(proxy);
    const { token } = mintTaskTicket("broker", { aud: "hermes", model: "oc/free" });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const path of ["/chat/completions", "/responses", "/images/generations"]) {
      const response = await fetch(`${proxy.url}${path}`, { method: "POST", headers, body: JSON.stringify({ model: "cx/paid" }) });
      expect(response.status).toBe(403);
    }
    expect(calls).toBe(0);
    const response = await fetch(`${proxy.url}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: "oc/free" }) });
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });
  it("exchanges a valid ticket for the upstream call and never forwards the ticket", async () => {
    const calls: Array<{ url: string; authorization: string; body: string }> = [];
    const proxy = await startTicketProxy({
      upstream: "http://127.0.0.1:20128/v1",
      apiKey: "gateway-secret",
      secret: "broker-secret",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          authorization: String((init?.headers as Record<string, string>).authorization),
          body: String(init?.body ?? "")
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });
    proxies.push(proxy);

    const { token } = mintTaskTicket("broker-secret", { aud: "hermes", model: "gc/grok-4.6" });
    const response = await fetch(`${proxy.url}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gc/grok-4.6" })
    });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:20128/v1/chat/completions");
    expect(calls[0]!.authorization).toBe("Bearer gateway-secret");
    expect(JSON.stringify(calls)).not.toContain(token);
  });

  it("rejects the raw gateway key and an expired ticket — workers cannot impersonate Control", async () => {
    const proxy = await startTicketProxy({
      upstream: "http://127.0.0.1:20128/v1",
      apiKey: "gateway-secret",
      secret: "broker-secret",
      fetchImpl: (async () => new Response("nope", { status: 500 })) as typeof fetch
    });
    proxies.push(proxy);

    const raw = await fetch(`${proxy.url}/models`, {
      headers: { authorization: "Bearer gateway-secret" }
    });
    expect(raw.status).toBe(401);
    expect(await raw.json()).toEqual({ error: "TICKET_INVALID" });

    const { token } = mintTaskTicket("broker-secret", {
      aud: "hermes",
      model: "m",
      ttlMs: 1,
      now: 1
    });
    const expired = await fetch(`${proxy.url}/models`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "TICKET_EXPIRED" });
  });
});
