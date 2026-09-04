#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRegistry } from "../dist/api/provider-registry.js";
import { ProviderRouter } from "../dist/api/provider-router.js";
import { ProviderExecutor } from "../dist/api/provider-executor.js";
import { FileProviderReceiptStore } from "../dist/api/provider-receipt-store.js";

class DeterministicProvider {
  constructor(providerId, { fail = false } = {}) {
    this.descriptor = {
      providerId,
      accessMode: "SUBSCRIPTION",
      capabilities: ["ai.code", "ai.review"],
      allowedSecurityClasses: ["S1"],
      external: true,
      priority: 10,
      enabled: true,
      transport: "OFFICIAL_CLI",
      authMode: "SUBSCRIPTION_OAUTH",
      billingMode: "SUBSCRIPTION_INCLUDED"
    };
    this.fail = fail;
  }
  async health() { return "HEALTHY"; }
  async canExecute() { return true; }
  async execute(request) {
    if (this.fail) throw new Error("PROVIDER_TIMEOUT");
    return { output: { providerId: this.descriptor.providerId, module: request.input.module, role: request.role } };
  }
}

const clock = { now: () => "2026-09-05T00:20:00.000Z" };

function request(role, capability, extra = {}) {
  return {
    requestId: `GOLDEN-${role}-${capability}`,
    taskId: "TASK-HELLO-PROVIDER-GOLDEN",
    tenantId: "TENANT-GOLDEN",
    role,
    capability,
    input: { module: "examples/hello-module" },
    securityClass: "S1",
    idempotencyKey: `HELLO-${role}-${capability}`,
    requirements: { externalProviderAllowed: true, billingPolicy: "SUBSCRIPTION_ONLY", ...extra }
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "provider-golden-"));
  try {
    const store = new FileProviderReceiptStore(join(root, "receipts"));

    const monoRegistry = new ProviderRegistry();
    monoRegistry.register(new DeterministicProvider("mono-builder"));
    const mono = await new ProviderExecutor(
      new ProviderRouter(monoRegistry, { mode: "MONO", providerId: "mono-builder" }),
      clock,
      store
    ).execute(request("BUILDER", "ai.code"));
    if (mono.receipts.length !== 1 || mono.receipts[0].providerId !== "mono-builder") throw new Error("MONO_GOLDEN_ROUTING_FAILED");
    if (mono.receipts[0].billingPath !== "SUBSCRIPTION_INCLUDED") throw new Error("MONO_GOLDEN_BILLING_FAILED");

    const multiRegistry = new ProviderRegistry();
    multiRegistry.register(new DeterministicProvider("builder-a"));
    multiRegistry.register(new DeterministicProvider("reviewer-b"));
    const multiRouter = new ProviderRouter(multiRegistry, { mode: "MULTI", strategy: "DIVERSE_REVIEW", providerOrder: ["builder-a", "reviewer-b"] });
    const builder = await new ProviderExecutor(multiRouter, clock, store).execute(request("BUILDER", "ai.code"));
    const builderProvider = builder.receipts.at(-1)?.providerId;
    if (!builderProvider) throw new Error("MULTI_BUILDER_MISSING");
    const reviewer = await new ProviderExecutor(multiRouter, clock, store).execute(request("REVIEWER", "ai.review", {
      providerDiversityRequired: true,
      diversityAgainstProviderId: builderProvider
    }));
    const reviewerProvider = reviewer.receipts.at(-1)?.providerId;
    if (!reviewerProvider || reviewerProvider === builderProvider) throw new Error("MULTI_DIVERSITY_FAILED");

    const failoverRegistry = new ProviderRegistry();
    failoverRegistry.register(new DeterministicProvider("timeout-a", { fail: true }));
    failoverRegistry.register(new DeterministicProvider("fallback-b"));
    const failover = await new ProviderExecutor(
      new ProviderRouter(failoverRegistry, { mode: "MULTI", strategy: "FAILOVER", providerOrder: ["timeout-a", "fallback-b"] }),
      clock,
      store
    ).execute(request("BUILDER", "ai.code", { allowProviderFailover: true }));
    if (failover.receipts.length !== 2 || failover.receipts[1].providerId !== "fallback-b") throw new Error("IDEMPOTENT_FAILOVER_FAILED");

    const all = await store.listByTask("TASK-HELLO-PROVIDER-GOLDEN");
    if (all.length !== 5) throw new Error(`PROVIDER_RECEIPT_COUNT:${all.length}`);
    if (!all.every((receipt) => receipt.billingPath === "SUBSCRIPTION_INCLUDED")) throw new Error("PROVIDER_RECEIPT_BILLING_PATH_MISSING");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      module: "examples/hello-module",
      monoProvider: mono.receipts[0].providerId,
      multi: { builderProvider, reviewerProvider },
      failover: failover.receipts.map((receipt) => ({ providerId: receipt.providerId, result: receipt.result })),
      persistedReceipts: all.length
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
