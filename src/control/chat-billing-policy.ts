import type { ChatModelBillingSource, ChatModelCatalog, ChatModelRouteTransport } from "./chat-model-catalog.js";

export type ChatBillingPolicyOptions = {
  allowFreeRequested?: boolean;
  allowPaidApi?: boolean;
  allowUnknown?: boolean;
};

export type ChatBillingDecision = {
  model: string;
  source: ChatModelBillingSource;
  transport: ChatModelRouteTransport;
  subscriptionHarnessUsed: boolean;
  allowed: boolean;
  decision:
    | "ALLOW_FREE_CONFIRMED"
    | "ALLOW_FREE_OAUTH"
    | "ALLOW_SUBSCRIPTION_HARNESS"
    | "ALLOW_FREE_REQUESTED_OVERRIDE"
    | "ALLOW_PAID_API_OVERRIDE"
    | "ALLOW_UNKNOWN_OVERRIDE"
    | "BLOCK_FREE_UNCONFIRMED"
    | "BLOCK_PAID_API"
    | "BLOCK_PAID_API_BUDGET_EXHAUSTED"
    | "BLOCK_UNKNOWN";
  checkedAt: string;
};

const PROTECTED_PREFIX_SOURCE: Record<string, ChatModelBillingSource> = {
  kmc: "SUBSCRIPTION_HARNESS",
  cu: "SUBSCRIPTION_HARNESS",
  kc: "SUBSCRIPTION_HARNESS",
  cl: "SUBSCRIPTION_HARNESS",
  aq: "FREE_OAUTH",
  agy: "FREE_OAUTH",
  of: "FREE_OAUTH",
  kr: "FREE_OAUTH",
  kiro: "FREE_OAUTH",
  qw: "FREE_OAUTH",
  // OmniRoute v3.8.51 declares these aliases as no-auth providers with hasFree=true.
  // They require no vendor login or paid API key and are admitted only after a
  // real inference probe in the free-swarm bootstrap.
  oc: "FREE_CONFIRMED",
  ddgw: "FREE_CONFIRMED",
  unc: "FREE_CONFIRMED",
  horde: "FREE_CONFIRMED"
};

function protectedPrefixSource(model: string): ChatModelBillingSource | undefined {
  const slash = model.indexOf("/");
  if (slash <= 0) return undefined;
  return PROTECTED_PREFIX_SOURCE[model.slice(0, slash).toLowerCase()];
}

export function evaluateChatBilling(
  model: string,
  catalog: ChatModelCatalog,
  options: ChatBillingPolicyOptions = {}
): ChatBillingDecision {
  const catalogSource = catalog.billing?.modelSources[model];
  const prefixSource = protectedPrefixSource(model);
  // A live OmniRoute catalog may omit billing metadata for no-auth transports.
  // Prefer explicit catalog provenance when it is meaningful, but allow a
  // repository-audited prefix classification to replace only UNKNOWN/missing.
  const source = catalogSource && catalogSource !== "UNKNOWN"
    ? catalogSource
    : prefixSource ?? catalogSource ?? "UNKNOWN";
  const route = catalog.billing?.modelRoutes?.[model];
  const transport: ChatModelRouteTransport = route?.transport
    ?? (source === "SUBSCRIPTION_HARNESS" || source === "FREE_OAUTH" ? "OMNIROUTE_OAUTH" : "OMNIROUTE_API");
  const subscriptionHarnessUsed = route?.subscriptionHarnessUsed ?? source === "SUBSCRIPTION_HARNESS";
  const base = {
    model,
    source,
    transport,
    subscriptionHarnessUsed,
    checkedAt: catalog.checkedAt
  };

  if (source === "SUBSCRIPTION_HARNESS") {
    return { ...base, allowed: true, decision: "ALLOW_SUBSCRIPTION_HARNESS" };
  }
  if (source === "FREE_OAUTH") {
    return { ...base, allowed: true, decision: "ALLOW_FREE_OAUTH" };
  }
  if (source === "FREE_CONFIRMED") {
    return { ...base, allowed: true, decision: "ALLOW_FREE_CONFIRMED" };
  }
  if (source === "FREE_REQUESTED") {
    return options.allowFreeRequested === true
      ? { ...base, allowed: true, decision: "ALLOW_FREE_REQUESTED_OVERRIDE" }
      : { ...base, allowed: false, decision: "BLOCK_FREE_UNCONFIRMED" };
  }
  if (source === "PAID_API") {
    if (catalog.billing?.budget?.exhausted === true) {
      return { ...base, allowed: false, decision: "BLOCK_PAID_API_BUDGET_EXHAUSTED" };
    }
    return options.allowPaidApi === true
      ? { ...base, allowed: true, decision: "ALLOW_PAID_API_OVERRIDE" }
      : { ...base, allowed: false, decision: "BLOCK_PAID_API" };
  }
  return options.allowUnknown === true
    ? { ...base, allowed: true, decision: "ALLOW_UNKNOWN_OVERRIDE" }
    : { ...base, allowed: false, decision: "BLOCK_UNKNOWN" };
}

export function chatBillingErrorCode(decision: ChatBillingDecision): string | null {
  if (decision.allowed) return null;
  if (decision.decision === "BLOCK_FREE_UNCONFIRMED") return "CHAT_BILLING_FREE_UNCONFIRMED";
  if (decision.decision === "BLOCK_PAID_API_BUDGET_EXHAUSTED") return "CHAT_BILLING_BUDGET_EXHAUSTED";
  if (decision.decision === "BLOCK_PAID_API") return "CHAT_BILLING_PAID_API_BLOCKED";
  return "CHAT_BILLING_UNKNOWN_BLOCKED";
}
