const usage24h = document.getElementById("usage24h");
const runtimeModelSelect = document.getElementById("modelSelect");
const runtimeBillingBadge = document.getElementById("billingBadge");
const runtimeBillingNote = document.querySelector(".composer-note");
const runtimeStatusText = document.getElementById("statusText");
const runtimeStatusDot = document.getElementById("statusDot");
const runtimeUsageBar = document.querySelector(".chat-usage-bar");

const RUNTIME_PREFIXES = {
  claude: ["cc/", "claude-code/"],
  grok: ["gc/", "xao/"],
  codex: ["cx/", "codex/"]
};
const RUNTIME_FAMILY_PRIORITY = ["claude", "grok", "codex"];
const NOAUTH_FREE_PREFIXES = ["oc/", "ddgw/", "unc/", "horde/"];
let latestOmniRoutes = [];
let routeRefreshInFlight = false;

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number < 1000) return String(number);
  if (number < 1_000_000) return `${(number / 1000).toFixed(number >= 100_000 ? 0 : 1)}k`;
  return `${(number / 1_000_000).toFixed(number >= 100_000_000 ? 0 : 1)}m`;
}

function providerReceiptUsage(receipts) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let harnessTokens = 0;
  let paidTokens = 0;
  let harnessRequests = 0;
  let paidRequests = 0;
  let unreported = 0;
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    const time = Date.parse(receipt.completedAt || receipt.startedAt || "");
    if (!Number.isFinite(time) || time < cutoff || receipt.result !== "SUCCESS") continue;
    const billing = String(receipt.billingPath || "UNKNOWN").toUpperCase();
    const total = Number(receipt.usage?.totalTokens);
    const tokens = Number.isFinite(total) ? total : Number(receipt.usage?.inputTokens || 0) + Number(receipt.usage?.outputTokens || 0);
    const reported = receipt.usage && Number.isFinite(tokens);
    if (billing === "SUBSCRIPTION_INCLUDED" || billing === "SUBSCRIPTION_CREDITS") {
      harnessRequests += 1;
      if (reported) harnessTokens += tokens;
      else unreported += 1;
    } else if (billing === "API_PAYG") {
      paidRequests += 1;
      if (reported) paidTokens += tokens;
      else unreported += 1;
    }
  }
  return { harnessTokens, paidTokens, harnessRequests, paidRequests, unreported };
}

function bucket(chat, source) {
  return chat.bySource?.[source] || {};
}

async function loadUsage24h() {
  if (!usage24h) return;
  try {
    const [chatResponse, providerResponse] = await Promise.all([
      fetch("/api/chat/usage?hours=24", { headers: { accept: "application/json" } }),
      fetch("/api/provider-receipts?limit=200", { headers: { accept: "application/json" } })
    ]);
    if (!chatResponse.ok || !providerResponse.ok) throw new Error("USAGE_HTTP_ERROR");
    const chat = await chatResponse.json();
    const providerPayload = await providerResponse.json();
    const provider = providerReceiptUsage(providerPayload.receipts);

    const confirmedFree = bucket(chat, "FREE_CONFIRMED");
    const freeOauth = bucket(chat, "FREE_OAUTH");
    const liveHarness = bucket(chat, "SUBSCRIPTION_HARNESS");
    const requested = bucket(chat, "FREE_REQUESTED");
    const chatPaid = bucket(chat, "PAID_API");
    const unknown = bucket(chat, "UNKNOWN");

    const freeTokens = Number(confirmedFree.totalTokens || 0) + Number(freeOauth.totalTokens || 0);
    const harnessTokens = Number(liveHarness.totalTokens || 0) + provider.harnessTokens;
    const paidTokens = Number(chatPaid.totalTokens || 0) + provider.paidTokens;
    const unknownRequests = Number(unknown.requests || 0) + Number(requested.requests || 0);
    const unreported = Number(chat.tokenTelemetryUnreported || 0) + provider.unreported;

    usage24h.textContent = `24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`;
    usage24h.className = `usage-24h ${paidTokens > 0 || unknownRequests > 0 ? "attention" : "clean"}`;
    usage24h.title = [
      `Confirmed free API: ${confirmedFree.requests || 0} requests / ${confirmedFree.totalTokens || 0} reported tokens`,
      `Free OAuth: ${freeOauth.requests || 0} requests / ${freeOauth.totalTokens || 0} reported tokens`,
      `Live Chat subscription harness: ${liveHarness.requests || 0} requests / ${liveHarness.totalTokens || 0} reported tokens`,
      `Other provider subscription receipts: ${provider.harnessRequests} requests / ${provider.harnessTokens} reported tokens`,
      `PAYG API: ${Number(chatPaid.requests || 0) + provider.paidRequests} requests / ${paidTokens} reported tokens`,
      `Unconfirmed or unknown billing: ${unknownRequests} requests`,
      `Requests without provider token telemetry: ${unreported}`,
      "Token totals include only provider-reported usage. No estimates are presented as facts."
    ].join("\n");
  } catch {
    usage24h.textContent = "24H USAGE · TELEMETRY UNAVAILABLE";
    usage24h.className = "usage-24h attention";
    usage24h.title = "Usage provenance could not be loaded. Treat token source as unverified until telemetry recovers.";
  }
}

function runtimeBadge() {
  if (!runtimeUsageBar) return null;
  let badge = document.getElementById("runtimeRouteBadge");
  if (badge) return badge;
  badge = document.createElement("span");
  badge.id = "runtimeRouteBadge";
  badge.className = "runtime-route-badge checking";
  badge.textContent = "ROUTE · CHECKING";
  const anchor = runtimeBillingBadge?.nextSibling;
  if (anchor) runtimeUsageBar.insertBefore(badge, anchor);
  else runtimeUsageBar.appendChild(badge);
  return badge;
}

function isSafeModelId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9._:/-]{1,160}$/.test(value)
    && !value.toLowerCase().includes("deepseek");
}

function familyForModel(model) {
  const value = String(model || "").toLowerCase();
  for (const [family, prefixes] of Object.entries(RUNTIME_PREFIXES)) {
    if (prefixes.some((prefix) => value.startsWith(prefix))) return family;
  }
  return null;
}

function isNoAuthFree(model) {
  const value = String(model || "").toLowerCase();
  return NOAUTH_FREE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function shortModel(model) {
  const value = String(model || "");
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function optionForModel(model) {
  if (!runtimeModelSelect) return null;
  return [...runtimeModelSelect.options].find((option) => option.value === model) || null;
}

function baseOptionLabel(option) {
  if (!option.dataset.runtimeBaseLabel) option.dataset.runtimeBaseLabel = option.textContent || option.value;
  return option.dataset.runtimeBaseLabel;
}

function routeHealthSuffix(route, exact) {
  if (!route) return "";
  if (route.health === "HEALTHY") return exact ? " · ✓ LIVE" : " · NOT PROBED";
  if (route.health === "RATE_LIMITED") return " · QUOTA";
  if (route.health === "AUTH_REQUIRED") return " · AUTH";
  if (route.health === "DEGRADED") return " · DEGRADED";
  return " · OFFLINE";
}

function rebuildNoAuthOptions(models) {
  if (!runtimeModelSelect) return;
  const selected = runtimeModelSelect.value;
  let group = document.getElementById("runtimeNoAuthModels");
  if (!group) {
    group = document.createElement("optgroup");
    group.id = "runtimeNoAuthModels";
    group.label = "FREE NO-AUTH · LIVE CATALOG";
    runtimeModelSelect.appendChild(group);
  }
  group.textContent = "";
  const freeModels = (Array.isArray(models) ? models : [])
    .filter((model) => isSafeModelId(model) && isNoAuthFree(model))
    .sort((a, b) => a.localeCompare(b));
  for (const model of freeModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = `${shortModel(model)} · FREE CONFIRMED · NO LOGIN`;
    option.dataset.runtimeBaseLabel = option.textContent;
    option.dataset.runtimeFree = "true";
    group.appendChild(option);
  }
  if (freeModels.includes(selected)) runtimeModelSelect.value = selected;
}

function annotateRuntimeOptions(routes) {
  if (!runtimeModelSelect) return;
  const byFamily = new Map(routes.map((route) => [route.family, route]));
  for (const option of [...runtimeModelSelect.options]) {
    const model = option.value;
    if (!model) continue;
    if (isNoAuthFree(model)) {
      option.disabled = false;
      option.textContent = `${baseOptionLabel(option).replace(/ · (?:✓ LIVE|NOT PROBED|QUOTA|AUTH|DEGRADED|OFFLINE)$/, "")} · ✓ NO LOGIN`;
      option.dataset.runtimeHealth = "HEALTHY";
      continue;
    }
    const family = familyForModel(model);
    if (!family) continue;
    const route = byFamily.get(family);
    if (!route) continue;
    const exact = route.model === model;
    option.disabled = route.health !== "HEALTHY" || !exact;
    option.textContent = `${baseOptionLabel(option)}${routeHealthSuffix(route, exact)}`;
    option.dataset.runtimeHealth = exact ? route.health : "UNVERIFIED";
  }
}

function applyAuditedFreeUi() {
  if (!runtimeModelSelect || !isNoAuthFree(runtimeModelSelect.value)) return false;
  runtimeModelSelect.dataset.billingSource = "FREE_CONFIRMED";
  runtimeModelSelect.dataset.billingAllowed = "true";
  if (runtimeBillingBadge) {
    runtimeBillingBadge.textContent = "FREE CONFIRMED";
    runtimeBillingBadge.className = "billing-badge free_confirmed";
    runtimeBillingBadge.title = "OmniRoute no-auth provider. No vendor login or PAYG API route is required.";
  }
  if (runtimeBillingNote) {
    runtimeBillingNote.textContent = `Live no-auth route selected: ${runtimeModelSelect.value}. No vendor login or PAYG API route is required; upstream anonymous rate limits can still apply.`;
  }
  window.dispatchEvent(new CustomEvent("koordynator:billing-change", {
    detail: { model: runtimeModelSelect.value, source: "FREE_CONFIRMED", allowed: true }
  }));
  return true;
}

function selectHealthyRuntimeRoute(routes) {
  if (!runtimeModelSelect || !runtimeModelSelect.value) return;
  const current = runtimeModelSelect.value;
  if (isNoAuthFree(current)) {
    applyAuditedFreeUi();
    return;
  }
  const family = familyForModel(current);
  const currentRoute = routes.find((route) => route.family === family);
  const currentIsHealthy = currentRoute?.health === "HEALTHY" && currentRoute.model === current;
  if (currentIsHealthy || !family) return;

  let target = null;
  for (const preferredFamily of RUNTIME_FAMILY_PRIORITY) {
    const route = routes.find((item) => item.family === preferredFamily && item.health === "HEALTHY");
    const option = route ? optionForModel(route.model) : null;
    if (option && !option.disabled) {
      target = route.model;
      break;
    }
  }
  if (!target) {
    const freeOption = [...runtimeModelSelect.options].find((option) => isNoAuthFree(option.value) && !option.disabled);
    target = freeOption?.value || null;
  }
  if (!target || target === current) return;
  runtimeModelSelect.value = target;
  runtimeModelSelect.dispatchEvent(new Event("change", { bubbles: true }));
  applyAuditedFreeUi();
}

function renderRuntimeRouteBadge(routes) {
  const badge = runtimeBadge();
  if (!badge || !runtimeModelSelect) return;
  const selected = runtimeModelSelect.value;
  if (isNoAuthFree(selected)) {
    badge.textContent = `LIVE · ${selected}`;
    badge.className = "runtime-route-badge live free";
    badge.title = "No-auth OmniRoute route from the live model catalog.";
    return;
  }
  const family = familyForModel(selected);
  const route = routes.find((item) => item.family === family);
  if (!route) {
    badge.textContent = selected ? `CATALOG · ${selected}` : "ROUTE · NONE";
    badge.className = "runtime-route-badge checking";
    badge.title = "This route is catalogued but does not have a live family probe in the current Control runtime.";
    return;
  }
  if (route.health === "HEALTHY" && route.model === selected) {
    badge.textContent = `LIVE · ${selected}`;
    badge.className = "runtime-route-badge live";
    badge.title = "Live OmniRoute inference probe passed.";
    return;
  }
  const labels = {
    RATE_LIMITED: "QUOTA",
    AUTH_REQUIRED: "AUTH",
    DEGRADED: "DEGRADED",
    UNAVAILABLE: "OFFLINE"
  };
  badge.textContent = `${labels[route.health] || "UNAVAILABLE"} · ${selected}`;
  badge.className = `runtime-route-badge ${String(route.health || "degraded").toLowerCase()}`;
  badge.title = route.detail || "Live route probe failed.";
}

async function reconcileRuntimeRoutes(force = false) {
  if (!runtimeModelSelect || routeRefreshInFlight) return;
  routeRefreshInFlight = true;
  const badge = runtimeBadge();
  try {
    const [catalogResponse, providerResponse] = await Promise.all([
      fetch("/api/chat/models", { headers: { accept: "application/json" } }),
      fetch(`/api/providers${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } })
    ]);
    if (!catalogResponse.ok || !providerResponse.ok) throw new Error("ROUTE_HEALTH_HTTP_ERROR");
    const catalog = await catalogResponse.json();
    const providers = await providerResponse.json();
    latestOmniRoutes = Array.isArray(providers.omniRoutes)
      ? providers.omniRoutes.filter((route) => route && typeof route.family === "string" && typeof route.model === "string")
      : [];
    rebuildNoAuthOptions(catalog.models);
    annotateRuntimeOptions(latestOmniRoutes);
    selectHealthyRuntimeRoute(latestOmniRoutes);
    renderRuntimeRouteBadge(latestOmniRoutes);
  } catch {
    if (badge) {
      badge.textContent = "ROUTE HEALTH · UNAVAILABLE";
      badge.className = "runtime-route-badge degraded";
      badge.title = "Live route health could not be loaded. The existing catalog selection was left unchanged.";
    }
  } finally {
    routeRefreshInFlight = false;
  }
}

function annotateLatestGenerationError() {
  if (!runtimeStatusText || !runtimeStatusDot?.classList.contains("error")) return;
  const text = runtimeStatusText.textContent?.trim();
  if (!text) return;
  const assistants = [...document.querySelectorAll(".chat-message.assistant")];
  const article = assistants.at(-1);
  if (!article) return;
  const status = article.querySelector(".message-state");
  const streaming = article.querySelector(".stream-caret");
  if (!status || (!streaming && status.textContent && status.textContent !== "Generation failed")) return;
  streaming?.remove();
  status.className = "message-state error";
  status.textContent = text;
  status.title = text;
}

runtimeModelSelect?.addEventListener("change", () => {
  applyAuditedFreeUi();
  renderRuntimeRouteBadge(latestOmniRoutes);
});

if (runtimeStatusText && runtimeStatusDot) {
  new MutationObserver(() => annotateLatestGenerationError()).observe(runtimeStatusText, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

void loadUsage24h();
setInterval(() => void loadUsage24h(), 10_000);

Promise.resolve(window.koordynatorChatModelsReady ?? true).then((ready) => {
  if (ready === false) return;
  window.setTimeout(() => void reconcileRuntimeRoutes(true), 250);
  window.setTimeout(() => void reconcileRuntimeRoutes(false), 1_500);
});
setInterval(() => void reconcileRuntimeRoutes(false), 30_000);
window.addEventListener("focus", () => {
  void loadUsage24h();
  void reconcileRuntimeRoutes(true);
});
