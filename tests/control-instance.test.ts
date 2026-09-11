import { describe, expect, it } from "vitest";
import { chooseControlPort, isKoordynatorControl } from "../src/runtime/control-instance.js";

describe("control instance startup", () => {
  it("recognizes an existing Koordynator control server", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      ok: true,
      version: "0.4.0",
      liveChatBillingPolicy: "STRICT_PROVENANCE"
    }), { status: 200, headers: { "content-type": "application/json" } });

    expect(await isKoordynatorControl("http://127.0.0.1:8787", fakeFetch as typeof fetch)).toBe(true);
  });

  it("does not mistake an unrelated service for Koordynator", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ ok: true, version: "other" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

    expect(await isKoordynatorControl("http://127.0.0.1:8787", fakeFetch as typeof fetch)).toBe(false);
  });

  it("chooses the next free port when the default is occupied", async () => {
    const checked: number[] = [];
    const available = async (_host: string, port: number) => {
      checked.push(port);
      return port === 8789;
    };

    await expect(chooseControlPort("127.0.0.1", 8787, false, available)).resolves.toBe(8789);
    expect(checked).toEqual([8787, 8788, 8789]);
  });

  it("fails closed when an explicitly configured port is occupied", async () => {
    const unavailable = async () => false;
    await expect(chooseControlPort("127.0.0.1", 8787, true, unavailable))
      .rejects.toThrow("KOORDYNATOR_CONTROL_PORT_IN_USE");
  });
});
