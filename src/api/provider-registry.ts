import type { ProviderAdapter, ProviderHealth } from "./provider-contract.js";

export type ProviderStatus = {
  providerId: string;
  name: string;
  health: ProviderHealth;
  enabled: boolean;
};

function fallbackName(providerId: string): string {
  const names: Record<string, string> = {
    omniroute: "OmniRoute",
    "openai-codex-sub": "OpenAI Codex",
    "claude-code-sub": "Claude Code",
    "gemini-cli-sub": "Google Gemini",
    "github-copilot-sub": "GitHub Copilot"
  };
  return names[providerId] ?? providerId;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): void {
    const id = provider.descriptor.providerId;
    if (this.providers.has(id)) throw new Error("PROVIDER_ALREADY_REGISTERED");
    this.providers.set(id, provider);
  }

  replace(provider: ProviderAdapter): void {
    this.providers.set(provider.descriptor.providerId, provider);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): ProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`PROVIDER_NOT_FOUND:${id}`);
    return provider;
  }

  all(): ProviderAdapter[] {
    return [...this.providers.values()];
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  async status(): Promise<ProviderStatus[]> {
    return await Promise.all(this.all().map(async (provider) => ({
      providerId: provider.descriptor.providerId,
      name: provider.descriptor.displayName ?? fallbackName(provider.descriptor.providerId),
      health: await provider.health(),
      enabled: provider.descriptor.enabled
    })));
  }
}
