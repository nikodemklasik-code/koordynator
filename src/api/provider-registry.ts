import type { ProviderAdapter } from "./provider-contract.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): void {
    const id = provider.descriptor.providerId;
    if (this.providers.has(id)) throw new Error("PROVIDER_ALREADY_REGISTERED");
    this.providers.set(id, provider);
  }

  get(id: string): ProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`PROVIDER_NOT_FOUND:${id}`);
    return provider;
  }

  all(): ProviderAdapter[] {
    return [...this.providers.values()];
  }
}
