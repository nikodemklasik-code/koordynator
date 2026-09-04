import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { CapabilityRequest } from "./capability-api.js";
import type { ProviderResult } from "./provider-contract.js";
import type { ProviderExecutionReceipt } from "./provider-receipt.js";
import { ProviderRouter } from "./provider-router.js";

export type Clock = { now(): string };

export type ProviderExecutionOutcome<T> = {
  result: ProviderResult<T>;
  receipts: ProviderExecutionReceipt[];
};

export class ProviderExecutor {
  constructor(private readonly router: ProviderRouter, private readonly clock: Clock) {}

  async execute<T>(request: CapabilityRequest): Promise<ProviderExecutionOutcome<T>> {
    const providers = await this.router.candidates(request);
    const receipts: ProviderExecutionReceipt[] = [];
    const { input: _input, ...requestMeta } = request;
    const requestFp = canonicalDigest(requestMeta);
    const inputFp = canonicalDigest(request.input);

    for (const [index, provider] of providers.entries()) {
      const startedAt = this.clock.now();
      try {
        const result = await provider.execute<T>(request);
        const completedAt = this.clock.now();
        const base = {
          requestFp,
          capability: request.capability,
          providerId: provider.descriptor.providerId,
          accessMode: provider.descriptor.accessMode,
          inputFp,
          outputFp: canonicalDigest(result.output),
          startedAt,
          completedAt,
          result: "SUCCESS" as const
        };
        receipts.push({ ...base, receiptFp: canonicalDigest(base) });
        return { result, receipts };
      } catch (error) {
        const completedAt = this.clock.now();
        const failureCode = error instanceof Error ? error.message : "UNKNOWN_PROVIDER_ERROR";
        const base = {
          requestFp,
          capability: request.capability,
          providerId: provider.descriptor.providerId,
          accessMode: provider.descriptor.accessMode,
          inputFp,
          startedAt,
          completedAt,
          result: "FAIL" as const,
          failureCode
        };
        receipts.push({ ...base, receiptFp: canonicalDigest(base) });

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
