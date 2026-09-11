import { describe, expect, it } from "vitest";
import { SideEffectRegistry } from "../src/domain/side-effect-idempotency.js";

describe("Side-effect idempotency", () => {
  it("returns the first result and does not re-run payment, migration, publish or deploy", async () => {
    const registry = new SideEffectRegistry();
    let runs = 0;
    const exec = async () => {
      runs += 1;
      return { id: "pay-1" };
    };
    const first = await registry.run({ key: "pay:invoice-9", kind: "payment" }, exec);
    const second = await registry.run({ key: "pay:invoice-9", kind: "payment" }, exec);
    expect(first).toEqual({ id: "pay-1" });
    expect(second).toEqual({ id: "pay-1" });
    expect(runs).toBe(1);
  });

  it("isolates keys per kind so a deploy key cannot satisfy a payment", async () => {
    const registry = new SideEffectRegistry();
    await registry.run({ key: "same", kind: "deploy" }, async () => ({ ok: "deployed" }));
    const payment = await registry.run({ key: "same", kind: "payment" }, async () => ({ ok: "paid" }));
    expect(payment).toEqual({ ok: "paid" });
  });

  it("rejects unknown side-effect kinds", async () => {
    const registry = new SideEffectRegistry();
    await expect(registry.run({ key: "x", kind: "email" as "message" }, async () => ({})))
      .rejects.toThrow(/SIDE_EFFECT_KIND_INVALID/);
  });
});
