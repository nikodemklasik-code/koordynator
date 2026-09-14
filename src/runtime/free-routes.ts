import { ChatModelCatalogService, type ChatModelCatalog, type ChatModelCatalogPort } from "../control/chat-model-catalog.js";
import { evaluateChatBilling } from "../control/chat-billing-policy.js";

export function freeRouteCandidates(catalog: ChatModelCatalog, preferred?: string): string[] {
  return [...new Set(catalog.models)].filter(model =>
    evaluateChatBilling(model, catalog, { freeOnly: true }).allowed
  ).sort((a, b) => Number(b === preferred) - Number(a === preferred)
    || Number(catalog.billing?.modelSources[a] !== "FREE_CONFIRMED") - Number(catalog.billing?.modelSources[b] !== "FREE_CONFIRMED"));
}

/** Live pricing evidence is required; a provider name or ':free' suffix is insufficient. */
export function freeRouteGuard(settings: { endpoint: string; apiKey: string }, catalogPort?: ChatModelCatalogPort) {
  const service = catalogPort ?? new ChatModelCatalogService(settings);
  let snapshot: ChatModelCatalog | undefined;
  let expires = 0;
  return async (model: string): Promise<boolean> => {
    if (!snapshot || Date.now() >= expires) {
      snapshot = await service.list();
      expires = Date.now() + 30_000;
    }
    return snapshot.models.includes(model) && evaluateChatBilling(model, snapshot, { freeOnly: true }).allowed;
  };
}

export type FreeRouteProbe = { model: string; status: "PASS" | "FAIL"; detail: string };

/** Small, bounded tool-call probe: chat-only models cannot power Hermes skills. */
export async function selectWorkingFreeRoutes(settings: { endpoint: string; apiKey: string; model: string }, options: {
  catalog?: ChatModelCatalogPort;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{ primary: string | null; fallbacks: string[]; probes: FreeRouteProbe[];
  diagnostics: { modelCount: number; freeCandidateCount: number; pricingAvailable: boolean; billingSources: Record<string, number> } }> {
  const catalog = await (options.catalog ?? new ChatModelCatalogService(settings)).list();
  const allCandidates = freeRouteCandidates(catalog, settings.model);
  const candidates = allCandidates.slice(0, 6);
  const billingSources: Record<string, number> = {};
  for (const model of catalog.models) {
    const source = catalog.billing?.modelSources[model] ?? "UNKNOWN";
    billingSources[source] = (billingSources[source] ?? 0) + 1;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const probes: FreeRouteProbe[] = [];
  const working: string[] = [];
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  for (const model of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || working.length >= 3) break;
    try {
      const response = await fetchImpl(`${settings.endpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, max_tokens: 64,
          messages: [{ role: "user", content: "Call koordynator_probe with no arguments." }],
          tools: [{ type: "function", function: { name: "koordynator_probe", description: "Verify tool calling", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
          tool_choice: { type: "function", function: { name: "koordynator_probe" } }
        }),
        signal: AbortSignal.timeout(Math.min(10_000, remaining))
      });
      if (!response.ok) {
        probes.push({ model, status: "FAIL", detail: `HTTP ${response.status}` });
        continue;
      }
      const payload = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
      const call = payload.choices?.[0]?.message?.tool_calls?.find(item => item.function?.name === "koordynator_probe");
      const ok = call?.function?.arguments !== undefined && JSON.stringify(JSON.parse(call.function.arguments)) === "{}";
      probes.push({ model, status: ok ? "PASS" : "FAIL", detail: ok ? "live tool call accepted; catalog reports free access" : "tool call missing or invalid" });
      if (ok) working.push(model);
    } catch {
      probes.push({ model, status: "FAIL", detail: "timeout, connection failure or invalid response" });
    }
  }
  return { primary: working[0] ?? null, fallbacks: working.slice(1), probes,
    diagnostics: { modelCount: catalog.models.length, freeCandidateCount: allCandidates.length,
      pricingAvailable: catalog.billing?.pricingAvailable === true, billingSources } };
}
