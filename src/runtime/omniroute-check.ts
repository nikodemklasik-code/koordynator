import { ChatModelCatalogService } from "../control/chat-model-catalog.js";
import { evaluateChatBilling } from "../control/chat-billing-policy.js";
import { omniRouteSettings } from "./local-config.js";

export async function checkOmniRoute(settings: ReturnType<typeof omniRouteSettings>, fetchImpl: typeof fetch = fetch) {
  if (!settings.apiKey) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  const catalog = await new ChatModelCatalogService({ endpoint: settings.endpoint, apiKey: settings.apiKey, fetchImpl }).list();
  const listed = catalog.models.includes(settings.model);
  const billing = evaluateChatBilling(settings.model, catalog);
  return { catalog, listed, billing, ready: listed && billing.allowed };
}

/** Explicit live inference only, with the same billing gate as Control chat. */
export async function probeOmniRoute(settings: ReturnType<typeof omniRouteSettings>, fetchImpl: typeof fetch = fetch) {
  const check = await checkOmniRoute(settings, fetchImpl);
  if (!check.listed) throw new Error("OMNIROUTE_MODEL_NOT_IN_CATALOG");
  if (!check.billing.allowed) throw new Error(check.billing.decision);
  let response: Response;
  try {
    response = await fetchImpl(`${settings.endpoint}/chat/completions`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({ model: settings.model, stream: false, max_tokens: 64,
        messages: [{ role: "user", content: "Reply with OK." }] })
    });
  } catch { throw new Error("OMNIROUTE_PROBE_UNAVAILABLE_OR_TIMEOUT"); }
  if (!response.ok) throw new Error(`OMNIROUTE_PROBE_HTTP_${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof body.choices?.[0]?.message?.content !== "string" || !body.choices[0].message.content.trim()) {
    throw new Error("OMNIROUTE_PROBE_EMPTY_RESPONSE");
  }
  return { inference: "PASS", toolCalling: "NOT_TESTED", model: settings.model };
}
