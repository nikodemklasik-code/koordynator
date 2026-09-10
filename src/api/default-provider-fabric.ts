import type { ProviderAdapter } from "./provider-contract.js";
import { OmniRouteProviderAdapter, type OmniRouteConfig } from "./omniroute-adapter.js";
import { ProviderRegistry } from "./provider-registry.js";
import { DEFAULT_AI_PROVIDER_PROFILE, ProviderRouter, type ProviderProfile } from "./provider-router.js";

export type DefaultProviderFabricOptions = {
  omniRoute?: OmniRouteConfig;
  additionalProviders?: ProviderAdapter[];
  profile?: ProviderProfile;
};

export type DefaultProviderFabric = {
  registry: ProviderRegistry;
  router: ProviderRouter;
};

export function createDefaultAiProviderFabric(options: DefaultProviderFabricOptions = {}): DefaultProviderFabric {
  const registry = new ProviderRegistry();
  registry.register(new OmniRouteProviderAdapter(options.omniRoute));
  for (const provider of options.additionalProviders ?? []) {
    if (registry.has(provider.descriptor.providerId)) registry.replace(provider);
    else registry.register(provider);
  }
  const router = new ProviderRouter(registry, options.profile ?? DEFAULT_AI_PROVIDER_PROFILE);
  return { registry, router };
}
