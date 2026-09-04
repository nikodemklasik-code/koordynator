import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { CapabilityRequest } from "./capability-api.js";
import type { ProviderAdapter, ProviderAuthMode, ProviderBillingMode, ProviderResult, ProviderTransport } from "./provider-contract.js";
import type { ProviderExecutionReceipt } from "./provider-receipt.js";
import type { ProviderReceiptStore } from "./provider-receipt-store.js";
import { ProviderRouter } from "./provider-router.js";

export type Clock = { now(): string };

export type ProviderExecutionOutcome<T> = {
  result: ProviderResult<T>;
  receipts: ProviderExecutionReceipt[];
};

function providerMetadata(provider: ProviderAdapter): {
  transport: ProviderTransport;
  authMode: ProviderAuthMode;
  billingPath: ProviderBillingMode;
} {
  const mode = provider.descriptor.accessMode;
  return {
    transport: provider.descriptor.transport ?? (mode === "SUBSCRIPTION" ? "OFFICIAL_CLI" : mode === "API" ? "RAW_API" : "LOCAL_RUNTIME"),
    authMode: provider.descriptor.authMode ?? (mode === "SUBSCRIPTION" ? "SUBSCRIPTION_OAUTH" : mode === "API" ? "API_KEY" : "LOCAL"),
    billingPath: provider.descriptor.billingMode ?? (mode === "SUBSCRIPTION" ? "SUBSCRIPTION_INCLUDED" : mode === "API" ? "API_PAYG" : "LOCAL")
  };
}

export class ProviderExecutor {
  constructor(
    private readonly router: ProviderRouter,
    private readonly clock: Clock,
    private readonly receiptStore?: ProviderReceiptStore
  ) {}

  private async record(receipt: ProviderExecutionReceipt, receipts: ProviderExecutionReceipt[]): Promise<void> {
    receipts.push(receipt);
    await this.receiptStore?.put(receipt);
  }

  async execute<T>(request: CapabilityRequest): Promise<ProviderExecutionOutcome<T>> {
    const providers = await this.router.candidates(request);
    const receipts: ProviderExecutionReceipt[] = [];
    const { input: _input, ...requestMeta } = request;
    const requestFp = canonicalDigest(requestMeta);
    const inputFp = request.inputFp ?? canonicalDigest(request.input);
    const routingPolicyFp = canonicalDigest(this.router.profile);
    const failedProviders: string[] = [];

    for (const [index, provider] of providers.entries()) {
      const startedAt = this.clock.now();
      const meta = providerMetadata(provider);
      try {
        const result = await provider.execute<T>(request);
        const completedAt = this.clock.now();
        const base = {
          executionId: `${request.requestId}:${index}`,
          taskId: request.taskId,
          tenantId: request.tenantId,
          requestFp,
          capability: request.capability,
          providerId: provider.descriptor.providerId,
          ...(provider.descriptor.adapterVersionFp === undefined ? {} : { providerAdapterVersionFp: provider.descriptor.adapterVersionFp }),
          accessMode: provider.descriptor.accessMode,
          transport: meta.transport,
          authMode: meta.authMode,
          billingPath: meta.billingPath,
          ...(result.seatId === undefined ? {} : { seatId: result.seatId }),
          routingPolicyFp,
          inputFp,
          outputFp: canonicalDigest(result.output),
          ...(result.workspaceBeforeFp === undefined ? {} : { workspaceBeforeFp: result.workspaceBeforeFp }),
          ...(result.workspaceAfterFp === undefined ? {} : { workspaceAfterFp: result.workspaceAfterFp }),
          startedAt,
          completedAt,
          result: "SUCCESS" as const,
          ...(failedProviders.length === 0 ? {} : { failoverFrom: [...failedProviders] })
        };
        const receipt: ProviderExecutionReceipt = { ...base, receiptFp: canonicalDigest(base) };
        await this.record(receipt, receipts);
        return { result, receipts };
      } catch (error) {
        const completedAt = this.clock.now();
        const failureCode = error instanceof Error ? error.message : "UNKNOWN_PROVIDER_ERROR";
        const result = failureCode.includes("TIMEOUT") ? "TIMEOUT" as const : failureCode.includes("BLOCK") ? "BLOCKED" as const : "FAIL" as const;
        const base = {
          executionId: `${request.requestId}:${index}`,
          taskId: request.taskId,
          tenantId: request.tenantId,
          requestFp,
          capability: request.capability,
          providerId: provider.descriptor.providerId,
          ...(provider.descriptor.adapterVersionFp === undefined ? {} : { providerAdapterVersionFp: provider.descriptor.adapterVersionFp }),
          accessMode: provider.descriptor.accessMode,
          transport: meta.transport,
          authMode: meta.authMode,
          billingPath: meta.billingPath,
          routingPolicyFp,
          inputFp,
          startedAt,
          completedAt,
          result,
          failureCode,
          ...(failedProviders.length === 0 ? {} : { failoverFrom: [...failedProviders] })
        };
        const receipt: ProviderExecutionReceipt = { ...base, receiptFp: canonicalDigest(base) };
        await this.record(receipt, receipts);
        failedProviders.push(provider.descriptor.providerId);

        const mayFailover = this.router.profile.mode === "MULTI"
          && request.requirements.allowProviderFailover === true
          && request.idempotencyKey !== undefined
          && index < providers.length - 1;
        if (!mayFailover) throw Object.assign(new Error(failureCode), { receipts });
      }
    }
    throw Object.assign(new Error("ALL_PROVIDERS_FAILED"), { receipts });
  }
}
