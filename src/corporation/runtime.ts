import { CorporationKernel } from "./kernel.js";
import type {
  CorporateEventStore,
  CorporationStateStore,
  CorporationTransactionStore,
  ExecutorRegistryPort
} from "./ports.js";
import {
  corporationRuntimeAuthoritiesFromEnv
} from "./runtime-authorities.js";
import type { AuthorityEpoch } from "./receipts.js";
import type { VerifierTrustRegistry } from "./verification-trust.js";
import type { VeraCoreAuthority } from "./vera-authority.js";

export type CorporationProductionRuntime = {
  kernel: CorporationKernel;
  vera: VeraCoreAuthority;
  close(): void;
};

/**
 * Compose the Corporation kernel with the real authority clients.
 *
 * This is the production bootstrap boundary for the v2 kernel. It intentionally
 * does not create email/browser/deploy adapters. Those effects stay unavailable
 * until a VERA-gated adapter runtime is separately wired.
 */
export function createCorporationProductionRuntime(input: {
  state: CorporationStateStore;
  events: CorporateEventStore;
  executors: ExecutorRegistryPort;
  transactional?: CorporationTransactionStore;
  verifierTrust?: VerifierTrustRegistry;
  approvalAuthority?: AuthorityEpoch;
  env?: NodeJS.ProcessEnv;
}): CorporationProductionRuntime {
  const authorities = corporationRuntimeAuthoritiesFromEnv(input.env ?? process.env);

  const kernel = new CorporationKernel({
    hll: authorities.hll,
    state: input.state,
    events: input.events,
    executors: input.executors,
    ...(input.transactional === undefined ? {} : { transactional: input.transactional }),
    ...(input.verifierTrust === undefined ? {} : { verifierTrust: input.verifierTrust }),
    ...(input.approvalAuthority === undefined ? {} : { approvalAuthority: input.approvalAuthority })
  });

  return {
    kernel,
    vera: authorities.vera,
    close: authorities.close
  };
}
