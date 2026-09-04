import type { CapabilityRequest } from "./capability-api.js";
import type { ProviderAdapter } from "./provider-contract.js";
import { ProviderRegistry } from "./provider-registry.js";

export type ProviderProfile =
  | { mode: "MONO"; providerId: string }
  | { mode: "MULTI"; strategy: "PRIMARY" | "POLICY"; providerOrder?: string[] };

export class ProviderRouter {
  constructor(private readonly registry: ProviderRegistry, private readonly profile: ProviderProfile) {}

  async select(request: CapabilityRequest): Promise<ProviderAdapter> {
    if (this.profile.mode === "MONO") {
      const provider = this.registry.get(this.profile.providerId);
      await this.assertAllowed(provider, request);
      return provider;
    }

    const order = this.profile.providerOrder ?? [];
    const rank = new Map(order.map((id, index) => [id, index]));
    const providers = this.registry.all().sort((a, b) => {
      const ra = rank.get(a.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      if (a.descriptor.priority !== b.descriptor.priority) return a.descriptor.priority - b.descriptor.priority;
      return a.descriptor.providerId.localeCompare(b.descriptor.providerId);
    });

    for (const provider of providers) {
      try {
        await this.assertAllowed(provider, request);
        return provider;
      } catch {
        // Multi-provider routing deliberately tries the next independently allowed provider.
      }
    }
    throw new Error("NO_ALLOWED_PROVIDER");
  }

  private async assertAllowed(provider: ProviderAdapter, request: CapabilityRequest): Promise<void> {
    const d = provider.descriptor;
    if (!d.enabled) throw new Error("PROVIDER_DISABLED");
    if (!d.capabilities.includes(request.capability)) throw new Error("CAPABILITY_UNSUPPORTED");
    if (!d.allowedSecurityClasses.includes(request.securityClass)) throw new Error("SECURITY_CLASS_DENIED");
    if (d.external && !request.requirements.externalProviderAllowed) throw new Error("EXTERNAL_PROVIDER_DENIED");
    const health = await provider.health();
    if (health === "UNAVAILABLE" || health === "BLOCKED" || health === "QUARANTINED") {
      throw new Error(`PROVIDER_${health}`);
    }
    if (!(await provider.canExecute(request))) throw new Error("PROVIDER_POLICY_DENIED");
  }
}
