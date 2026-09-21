import type { ChatBillingPolicyOptions, ChatBillingDecision } from "./chat-billing-policy.js";
import { evaluateChatBilling } from "./chat-billing-policy.js";
import type { ChatModelCatalog } from "./chat-model-catalog.js";

export type ExecutableChatModelResolution = {
  model: string;
  billing: ChatBillingDecision;
  recoveredFrom?: string;
};

export function isGenericAutoRoute(model: string): boolean {
  const value = model.trim().toLowerCase();
  return value === "auto" || value === "best-free" || value === "auto/best-free";
}

export function resolveExecutableChatModel(input: {
  requestedModel?: string | undefined;
  catalog: ChatModelCatalog;
  policy?: ChatBillingPolicyOptions | undefined;
  preferredModels?: string[] | undefined;
}): ExecutableChatModelResolution | null {
  const requested = input.requestedModel?.trim() || undefined;
  const listed = new Set(input.catalog.models);

  if (requested && listed.has(requested)) {
    return {
      model: requested,
      billing: evaluateChatBilling(requested, input.catalog, input.policy)
    };
  }

  const candidates = [
    ...(input.preferredModels ?? []),
    ...input.catalog.models
  ];

  for (const candidate of [...new Set(candidates.map((model) => model.trim()).filter(Boolean))]) {
    if (!listed.has(candidate)) continue;
    const billing = evaluateChatBilling(candidate, input.catalog, input.policy);
    if (!billing.allowed) continue;
    return {
      model: candidate,
      billing,
      ...(requested === undefined ? {} : { recoveredFrom: requested })
    };
  }

  if (requested) {
    return {
      model: requested,
      billing: evaluateChatBilling(requested, input.catalog, input.policy)
    };
  }

  return null;
}
