import type { BillingPolicy, CapabilityRequest } from "./capability-api.js";
import type { ProviderAdapter, ProviderAccessMode } from "./provider-contract.js";
import { ProviderRegistry } from "./provider-registry.js";

export type ProviderProfile =
  | { mode: "MONO"; providerId: string }
  | { mode: "MULTI"; strategy: "PRIMARY" | "POLICY" | "FAILOVER" | "LOWEST_LATENCY" | "LOWEST_COST" | "QUALITY" | "ROLE_PINNED" | "DIVERSE_REVIEW"; providerOrder?: string[] };

function billingRank(accessMode: ProviderAccessMode, policy: BillingPolicy | undefined): number {
  if (policy === "SUBSCRIPTION_FIRST") return accessMode === "SUBSCRIPTION" ? 0 : accessMode === "API" ? 1 : 2;
  if (policy === "API_FIRST") return accessMode === "API" ? 0 : accessMode === "SUBSCRIPTION" ? 1 : 2;
  if (policy === "LOCAL_ONLY") return accessMode === "LOCAL" ? 0 : 9;
  return 0;
}

export class ProviderRouter {
  constructor(private readonly registry: ProviderRegistry, readonly profile: ProviderProfile) {}

  async candidates(request: CapabilityRequest): Promise<ProviderAdapter[]> {
    if (this.profile.mode === "MONO") {
      const provider = this.registry.get(this.profile.providerId);
      await this.assertAllowed(provider, request);
      return [provider];
    }

    const order = this.profile.providerOrder ?? [];
    const rank = new Map(order.map((id, index) => [id, index]));
    const policy = request.requirements.billingPolicy;
    const providers = this.registry.all().sort((a, b) => {
      const billing = billingRank(a.descriptor.accessMode, policy) - billingRank(b.descriptor.accessMode, policy);
      if (billing !== 0) return billing;
      const ra = rank.get(a.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      if (a.descriptor.priority !== b.descriptor.priority) return a.descriptor.priority - b.descriptor.priority;
      return a.descriptor.providerId.localeCompare(b.descriptor.providerId);
    });

    const allowed: ProviderAdapter[] = [];
    for (const provider of providers) {
      try {
        await this.assertAllowed(provider, request);
        allowed.push(provider);
      } catch {
        // A denied/unhealthy provider is isolated; it cannot poison other candidates.
      }
    }
    if (allowed.length === 0) throw new Error("NO_ALLOWED_PROVIDER");
    return allowed;
  }

  async select(request: CapabilityRequest): Promise<ProviderAdapter> {
    return (await this.candidates(request))[0]!;
  }

  private assertBillingAllowed(provider: ProviderAdapter, request: CapabilityRequest): void {
    const mode = provider.descriptor.accessMode;
    const policy = request.requirements.billingPolicy;
    if (policy === "SUBSCRIPTION_ONLY" && mode !== "SUBSCRIPTION") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "API_ONLY" && mode !== "API") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "LOCAL_ONLY" && mode !== "LOCAL") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "SUBSCRIPTION_FIRST" && mode === "API") {
      const budget = request.requirements.maxCost ?? 0;
      if (request.requirements.allowPaidApiFallback !== true || budget <= 0) throw new Error("PAID_API_FALLBACK_NOT_AUTHORIZED");
    }
  }

  private async assertAllowed(provider: ProviderAdapter, request: CapabilityRequest): Promise<void> {
    const d = provider.descriptor;
    if (!d.enabled) throw new Error("PROVIDER_DISABLED");
    if (!d.capabilities.includes(request.capability)) throw new Error("CAPABILITY_UNSUPPORTED");
    if (!d.allowedSecurityClasses.includes(request.securityClass)) throw new Error("SECURITY_CLASS_DENIED");
    if (d.external && !request.requirements.externalProviderAllowed) throw new Error("EXTERNAL_PROVIDER_DENIED");
    if (request.requirements.providerDiversityRequired === true
      && request.requirements.diversityAgainstProviderId !== undefined
      && d.providerId === request.requirements.diversityAgainstProviderId) {
      throw new Error("PROVIDER_DIVERSITY_REQUIRED");
    }
    this.assertBillingAllowed(provider, request);
    const health = await provider.health();
    if (["UNAVAILABLE", "AUTH_REQUIRED", "RATE_LIMITED", "BLOCKED", "QUARANTINED"].includes(health)) {
      throw new Error(`PROVIDER_${health}`);
    }
    if (!(await provider.canExecute(request))) throw new Error("PROVIDER_POLICY_DENIED");
  }
}
