import { describe, expect, it } from "vitest";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderResult } from "../src/api/provider-contract.js";
import { ProviderExecutor } from "../src/api/provider-executor.js";
import { ProviderRegistry } from "../src/api/provider-registry.js";
import { ProviderRouter } from "../src/api/provider-router.js";
import { extractProviderReportedUsage } from "../src/api/provider-usage.js";

const descriptor: ProviderDescriptor = {
  providerId: "subscription-test",
  accessMode: "SUBSCRIPTION",
  capabilities: ["ai.code"],
  allowedSecurityClasses: ["S1"],
  external: true,
  priority: 1,
  enabled: true,
  transport: "OFFICIAL_CLI",
  authMode: "SUBSCRIPTION_OAUTH",
  billingMode: "SUBSCRIPTION_INCLUDED"
};

class UsageProvider implements ProviderAdapter {
  readonly descriptor = descriptor;
  async health() { return "HEALTHY" as const; }
  async canExecute() { return true; }
  async execute<T>(): Promise<ProviderResult<T>> {
    return {
      output: {
        text: "ok",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      } as T,
      seatId: "seat-subscription-test"
    };
  }
}

const request: CapabilityRequest = {
  requestId: "REQ-USAGE-1",
  taskId: "TASK-USAGE-1",
  tenantId: "TENANT-1",
  role: "BUILDER",
  capability: "ai.code",
  input: { task: "implement" },
  securityClass: "S1",
  requirements: {
    externalProviderAllowed: true,
    billingPolicy: "SUBSCRIPTION_ONLY"
  }
};

describe("Provider usage provenance", () => {
  it("extracts only provider-reported token telemetry", () => {
    expect(extractProviderReportedUsage({ usage: { prompt_tokens: 12, completion_tokens: 3 } })).toEqual({
      reportedBy: "PROVIDER",
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15
    });
    expect(extractProviderReportedUsage({ text: "no telemetry" })).toBeUndefined();
  });

  it("persists reported tokens on the same SUBSCRIPTION_INCLUDED receipt that proves harness billing", async () => {
    const registry = new ProviderRegistry();
    registry.register(new UsageProvider());
    const executor = new ProviderExecutor(
      new ProviderRouter(registry, { mode: "MONO", providerId: "subscription-test" }),
      { now: () => "2026-09-10T15:30:00.000Z" }
    );

    const outcome = await executor.execute(request);
    expect(outcome.receipts).toHaveLength(1);
    expect(outcome.receipts[0]).toMatchObject({
      providerId: "subscription-test",
      accessMode: "SUBSCRIPTION",
      transport: "OFFICIAL_CLI",
      billingPath: "SUBSCRIPTION_INCLUDED",
      seatId: "seat-subscription-test",
      usage: { reportedBy: "PROVIDER", inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    });
  });
});
