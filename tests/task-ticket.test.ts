import { describe, expect, it } from "vitest";
import { mintTaskTicket, verifyTaskTicket, bearerTicket } from "../src/security/task-ticket.js";

describe("Task ticket (worker credential)", () => {
  it("mints a verifiable ticket that expires", () => {
    const { token, claims } = mintTaskTicket("broker-secret", {
      aud: "hermes",
      model: "gc/grok-4.6",
      ttlMs: 1_000,
      now: 1_000
    });
    expect(token.startsWith("tkt.")).toBe(true);
    expect(verifyTaskTicket("broker-secret", token, 1_500)).toMatchObject({
      aud: "hermes",
      model: "gc/grok-4.6",
      jti: claims.jti
    });
    expect(() => verifyTaskTicket("broker-secret", token, 2_001)).toThrow(/TICKET_EXPIRED/);
  });

  it("rejects a forged signature, the wrong secret, and a missing bearer", () => {
    const { token } = mintTaskTicket("broker-secret", { aud: "hermes", model: "m" });
    expect(() => verifyTaskTicket("other-secret", token)).toThrow(/TICKET_INVALID/);
    expect(() => verifyTaskTicket("broker-secret", token.replace(/\.[^.]+$/, ".aaaa"))).toThrow(/TICKET_INVALID/);
    expect(() => bearerTicket("Basic abc")).toThrow(/TICKET_REQUIRED/);
    expect(bearerTicket(`Bearer ${token}`)).toBe(token);
  });

  it("does not mint without a broker secret — workers cannot issue their own tickets", () => {
    expect(() => mintTaskTicket("", { aud: "hermes", model: "m" })).toThrow(/TICKET_SECRET_REQUIRED/);
    expect(() => mintTaskTicket("  ", { aud: "opencode", model: "m" })).toThrow(/TICKET_SECRET_REQUIRED/);
  });
});
