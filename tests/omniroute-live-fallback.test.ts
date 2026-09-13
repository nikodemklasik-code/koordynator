import { describe, expect, it } from "vitest";
import { OmniRouteLiveStatusService } from "../src/control/omniroute-live-status.js";

describe("OmniRoute live family fallback", () => {
  it("tries another model in the same family before declaring the route failed", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [
          { id: "cc/claude-opus-5" },
          { id: "cc/claude-sonnet-5" },
          { id: "cx/gpt-5.6-sol" }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
        calls.push(String(body.model || ""));
        if (body.model === "cc/claude-opus-5") {
          return new Response(JSON.stringify({ error: { message: "model unavailable" } }), { status: 400 });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: "PONG" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const service = new OmniRouteLiveStatusService({
      endpoint: "http://127.0.0.1:20128/v1",
      apiKey: "test",
      fetchImpl
    });
    const routes = await service.list(true);
    const claude = routes.find((route) => route.family === "claude");
    expect(calls).toContain("cc/claude-opus-5");
    expect(calls).toContain("cc/claude-sonnet-5");
    expect(claude?.model).toBe("cc/claude-sonnet-5");
    expect(claude?.health).toBe("HEALTHY");
  });
});
