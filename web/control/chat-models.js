const chatModelSelect = document.getElementById("modelSelect");
const chatBillingNote = document.querySelector(".composer-note");
const chatBillingBadge = document.getElementById("billingBadge");
const chatSendButton = document.getElementById("sendButton");
const chatMessageInput = document.getElementById("messageInput");
const CHAT_MODEL_SESSION_KEY = "koordynator.liveChat.sessionId";
let catalogBilling = null;
let catalogEntries = [];
let billingPolicy = null;

const SOURCE_ORDER = {
  SUBSCRIPTION_HARNESS: 0,
  FREE_OAUTH: 1,
  FREE_CONFIRMED: 2,
  FREE_REQUESTED: 3,
  PAID_API: 4,
  UNKNOWN: 5
};

const FAMILY_ORDER = ["OPENAI", "ANTHROPIC", "GOOGLE / GEMINI", "XAI / GROK", "GITHUB COPILOT"];

function freeLike(modelId) {
  return /(?:^|[\/:._-])(?:best-)?free(?:$|[\/:._-])/i.test(modelId);
}

function knownSource(value) {
  return ["FREE_REQUESTED", "FREE_CONFIRMED", "FREE_OAUTH", "SUBSCRIPTION_HARNESS", "PAID_API", "UNKNOWN"].includes(value);
}

function sourceFor(modelId) {
  const explicit = catalogBilling?.modelSources?.[modelId];
  if (knownSource(explicit)) return explicit;
  return freeLike(modelId) ? "FREE_REQUESTED" : "UNKNOWN";
}

function routeFor(modelId) {
  const route = catalogBilling?.modelRoutes?.[modelId];
  return route && typeof route === "object" ? route : null;
}

function sourceLabel(source) {
  if (source === "SUBSCRIPTION_HARNESS") return "SUBSCRIPTION HARNESS";
  if (source === "FREE_OAUTH") return "FREE OAUTH";
  if (source === "FREE_CONFIRMED") return "FREE CONFIRMED";
  if (source === "FREE_REQUESTED") return "FREE REQUESTED · UNCONFIRMED";
  if (source === "PAID_API") return "PAID API";
  return "UNKNOWN BILLING";
}

function sourceAllowed(_source) {
  return true;
}

function routeReady() {
  return Boolean(
    chatModelSelect
    && chatModelSelect.dataset.catalog === "omniroute"
    && chatModelSelect.dataset.billingAllowed === "true"
    && chatModelSelect.value
  );
}

function enforceRouteGuard() {
  const ready = routeReady();
  if (chatSendButton && !ready && !chatSendButton.disabled) chatSendButton.disabled = true;
  if (chatModelSelect && chatModelSelect.dataset.catalog !== "omniroute" && !chatModelSelect.disabled) chatModelSelect.disabled = true;
}

if (chatSendButton) {
  new MutationObserver(() => enforceRouteGuard()).observe(chatSendButton, { attributes: true, attributeFilter: ["disabled"] });
}
if (chatModelSelect) {
  new MutationObserver(() => enforceRouteGuard()).observe(chatModelSelect, { attributes: true, attributeFilter: ["disabled", "data-catalog", "data-billing-allowed"] });
}
document.addEventListener("click", (event) => {
  if (event.target === chatSendButton && !routeReady()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    enforceRouteGuard();
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (event.target === chatMessageInput && event.key === "Enter" && !event.shiftKey && !routeReady()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    enforceRouteGuard();
  }
}, true);

function inferFamily(modelId) {
  const value = modelId.toLowerCase();
  if (/(?:^|\/)gpt[-._]/.test(value) || /(?:^|\/)(?:cx|codex)\//.test(`/${value}`)) return "OPENAI";
  if (/claude/.test(value)) return "ANTHROPIC";
  if (/gemini/.test(value)) return "GOOGLE / GEMINI";
  if (/grok|xai/.test(value)) return "XAI / GROK";
  if (/cohere|command|c4ai/.test(value)) return "COHERE";
  if (/groq/.test(value)) return "GROQ";
  if (/qwen/.test(value)) return "QWEN";
  if (/kimi/.test(value)) return "MOONSHOT / KIMI";
  if (/minimax/.test(value)) return "MINIMAX";
  if (/glm/.test(value)) return "GLM";
  if (/(?:^|\/)(?:auto|dva)\//.test(`/${value}`)) return "OMNIROUTE";
  return "OTHER";
}

function safeCatalogModels(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const models = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > 160 || id.toLowerCase().includes("deepseek")) continue;
    if (!/^[A-Za-z0-9._:/-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models;
}

function safeCatalogEntries(payload, models) {
  const byId = new Map();
  if (Array.isArray(payload?.entries)) {
    for (const raw of payload.entries) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string") continue;
      const id = raw.id.trim();
      if (!models.includes(id)) continue;
      const source = knownSource(raw.billingSource) ? raw.billingSource : sourceFor(id);
      byId.set(id, {
        id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
        provider: typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : routeFor(id)?.provider || "omniroute",
        family: typeof raw.family === "string" && raw.family.trim() ? raw.family.trim() : inferFamily(id),
        billingSource: source,
        transport: raw.transport === "OMNIROUTE_OAUTH" ? "OMNIROUTE_OAUTH" : "OMNIROUTE_API",
        subscriptionHarnessUsed: raw.subscriptionHarnessUsed === true,
        inputTokenLimit: Number.isFinite(Number(raw.inputTokenLimit)) ? Number(raw.inputTokenLimit) : undefined,
        supportsVision: raw.supportsVision === true
      });
    }
  }
  for (const id of models) {
    if (byId.has(id)) continue;
    const route = routeFor(id);
    byId.set(id, {
      id,
      name: id,
      provider: route?.provider || "omniroute",
      family: route?.family || inferFamily(id),
      billingSource: sourceFor(id),
      transport: route?.transport === "OMNIROUTE_OAUTH" ? "OMNIROUTE_OAUTH" : "OMNIROUTE_API",
      subscriptionHarnessUsed: route?.subscriptionHarnessUsed === true
    });
  }
  return [...byId.values()];
}

function shortName(entry) {
  if (entry.name && entry.name !== entry.id) return entry.name;
  const slash = entry.id.indexOf("/");
  return slash >= 0 ? entry.id.slice(slash + 1) : entry.id;
}

function entryLabel(entry) {
  const parts = [shortName(entry), sourceLabel(entry.billingSource)];
  if (entry.supportsVision) parts.push("VISION");
  if (entry.inputTokenLimit) parts.push(`${Math.round(entry.inputTokenLimit / 1000)}K CTX`);
  return parts.join(" · ");
}

function familyRank(family) {
  const index = FAMILY_ORDER.indexOf(family);
  return index >= 0 ? index : FAMILY_ORDER.length;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const familyDelta = familyRank(a.family) - familyRank(b.family);
    if (familyDelta) return familyDelta;
    if (familyRank(a.family) === FAMILY_ORDER.length) {
      const familyName = a.family.localeCompare(b.family);
      if (familyName) return familyName;
    }
    const sourceDelta = (SOURCE_ORDER[a.billingSource] ?? 99) - (SOURCE_ORDER[b.billingSource] ?? 99);
    if (sourceDelta) return sourceDelta;
    return shortName(a).localeCompare(shortName(b));
  });
}

async function desiredSessionModel(models, fallback) {
  const sessionId = localStorage.getItem(CHAT_MODEL_SESSION_KEY);
  if (!sessionId) return fallback;
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return fallback;
    const session = await response.json();
    return typeof session.model === "string" && models.includes(session.model) ? session.model : fallback;
  } catch {
    return fallback;
  }
}

function rebuildOptions(entries) {
  chatModelSelect.textContent = "";
  const grouped = new Map();
  for (const entry of sortEntries(entries)) {
    const list = grouped.get(entry.family) || [];
    list.push(entry);
    grouped.set(entry.family, list);
  }
  for (const [family, items] of grouped) {
    const group = document.createElement("optgroup");
    group.label = family;
    for (const entry of items) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entryLabel(entry);
      option.title = `${entry.id} · ${entry.provider} · ${sourceLabel(entry.billingSource)} · ${entry.transport}`;
      group.appendChild(option);
    }
    chatModelSelect.appendChild(group);
  }
}

function showCatalogFailure(message) {
  catalogBilling = null;
  catalogEntries = [];
  chatModelSelect.textContent = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Model catalog unavailable";
  option.disabled = true;
  option.selected = true;
  chatModelSelect.appendChild(option);
  chatModelSelect.dataset.catalog = "unavailable";
  chatModelSelect.dataset.billingAllowed = "false";
  chatModelSelect.disabled = true;
  chatModelSelect.title = message;
  if (chatBillingBadge) {
    chatBillingBadge.textContent = "NO VERIFIED ROUTE";
    chatBillingBadge.className = "billing-badge unknown";
  }
  if (chatBillingNote) chatBillingNote.textContent = `${message} No static fallback models are shown because an unverified route must not be presented as executable.`;
  enforceRouteGuard();
  window.dispatchEvent(new CustomEvent("koordynator:billing-change", { detail: { model: "", source: "UNKNOWN", allowed: false } }));
}

function billingSummary() {
  if (!chatModelSelect || !chatBillingNote || chatModelSelect.dataset.catalog !== "omniroute") return;
  const model = chatModelSelect.value;
  const entry = catalogEntries.find((item) => item.id === model);
  const source = entry?.billingSource || sourceFor(model);
  const allowed = sourceAllowed(source);
  const budget = catalogBilling?.budget;
  const budgetText = budget && typeof budget.remaining === "number"
    ? ` PAYG budget remaining: ${budget.remaining}${typeof budget.limit === "number" ? ` / ${budget.limit}` : ""}.`
    : "";
  const routeText = entry ? ` Route: ${entry.provider} via ${entry.transport === "OMNIROUTE_OAUTH" ? "OmniRoute OAuth/harness" : "OmniRoute API"}.` : "";
  const sourceText = source === "SUBSCRIPTION_HARNESS"
    ? "Subscription harness selected. Requests use the connected subscription/OAuth route rather than PAYG API billing. Provider quota may still apply."
    : source === "FREE_OAUTH"
      ? "Free OAuth route selected. No PAYG API route is selected; provider quota may still apply."
      : source === "FREE_CONFIRMED"
        ? "Free billing is confirmed by upstream catalog/pricing evidence."
        : source === "FREE_REQUESTED"
          ? "The model looks free by name, but billing is not independently confirmed."
          : source === "PAID_API"
            ? "PAYG API route selected."
            : "Billing source is unknown.";
  chatBillingNote.textContent = `${sourceText}${routeText}${budgetText}`;
  chatModelSelect.dataset.billingSource = source;
  chatModelSelect.dataset.billingAllowed = allowed ? "true" : "false";
  if (chatBillingBadge) {
    chatBillingBadge.textContent = sourceLabel(source);
    chatBillingBadge.className = `billing-badge ${source.toLowerCase()}`;
    chatBillingBadge.title = `${sourceText}${routeText}`;
  }
  enforceRouteGuard();
  window.dispatchEvent(new CustomEvent("koordynator:billing-change", { detail: { model, source, allowed } }));
}

async function loadChatModels() {
  if (!chatModelSelect) return;
  chatModelSelect.dataset.catalog = "loading";
  chatModelSelect.dataset.billingAllowed = "false";
  chatModelSelect.disabled = true;
  const previous = chatModelSelect.value;
  enforceRouteGuard();
  try {
    const [modelResponse, healthResponse] = await Promise.all([
      fetch("/api/chat/models", { headers: { accept: "application/json" } }),
      fetch("/api/health", { headers: { accept: "application/json" } })
    ]);
    if (!modelResponse.ok) throw new Error(`Model catalog HTTP ${modelResponse.status}`);
    const payload = await modelResponse.json();
    const health = healthResponse.ok ? await healthResponse.json() : {};
    billingPolicy = health && typeof health === "object" ? health : {};
    const models = safeCatalogModels(payload.models);
    if (!models.length) throw new Error("OmniRoute returned no chat-capable models");
    catalogBilling = payload.billing && typeof payload.billing === "object" ? payload.billing : null;
    catalogEntries = safeCatalogEntries(payload, models);

    const listed = catalogEntries;
    if (!listed.length) throw new Error("OmniRoute returned no chat-capable models");

    const listedIds = listed.map((entry) => entry.id);
    const preferred = listed.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id
      || listed.find((entry) => entry.billingSource === "FREE_OAUTH")?.id
      || listed.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id
      || (listedIds.includes(previous) ? previous : listedIds[0]);
    const desired = await desiredSessionModel(listedIds, preferred);
    rebuildOptions(listed);
    chatModelSelect.value = listedIds.includes(desired) ? desired : preferred;
    chatModelSelect.dataset.catalog = "omniroute";
    chatModelSelect.disabled = false;
    chatModelSelect.title = `${listed.length} OmniRoute models loaded.`;
    billingSummary();
  } catch (error) {
    showCatalogFailure(error instanceof Error ? error.message : "Model catalog unavailable");
  }
}

chatModelSelect?.addEventListener("change", billingSummary);
void loadChatModels();
