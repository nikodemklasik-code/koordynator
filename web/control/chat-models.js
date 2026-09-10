const chatModelSelect = document.getElementById("modelSelect");
const chatBillingNote = document.querySelector(".composer-note");
const chatBillingBadge = document.getElementById("billingBadge");
const CHAT_MODEL_SESSION_KEY = "koordynator.liveChat.sessionId";
let catalogBilling = null;

function freeLike(modelId) {
  return /(?:^|[\/:._-])(?:best-)?free(?:$|[\/:._-])/i.test(modelId);
}

function sourceFor(modelId) {
  const explicit = catalogBilling?.modelSources?.[modelId];
  if (["FREE_REQUESTED", "FREE_CONFIRMED", "PAID_API", "UNKNOWN"].includes(explicit)) return explicit;
  return freeLike(modelId) ? "FREE_REQUESTED" : "UNKNOWN";
}

function sourceLabel(source) {
  if (source === "FREE_CONFIRMED") return "FREE CONFIRMED";
  if (source === "FREE_REQUESTED") return "FREE REQUESTED · UNCONFIRMED";
  if (source === "PAID_API") return "PAID API · BLOCKED";
  return "UNKNOWN BILLING · BLOCKED";
}

function readableModelLabel(modelId) {
  const names = {
    "auto/best-free": "Best free route",
    "openai/gpt-5.6-sol": "GPT-5.6 Sol",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "anthropic/claude-opus-5": "Claude Opus 5"
  };
  let label = names[modelId];
  if (!label) {
    const slash = modelId.indexOf("/");
    label = slash < 0 ? modelId : `${modelId.slice(slash + 1)} · ${modelId.slice(0, slash)}`;
  }
  return `${label} · ${sourceLabel(sourceFor(modelId))}`;
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

function billingSummary() {
  if (!chatModelSelect || !chatBillingNote) return;
  const model = chatModelSelect.value;
  const source = sourceFor(model);
  const budget = catalogBilling?.budget;
  const budgetText = budget && typeof budget.remaining === "number"
    ? ` OmniRoute budget remaining: ${budget.remaining}${typeof budget.limit === "number" ? ` / ${budget.limit}` : ""}.`
    : " OmniRoute budget counter unavailable.";
  const sourceText = source === "FREE_CONFIRMED"
    ? "FREE billing confirmed by upstream catalog/pricing evidence."
    : source === "FREE_REQUESTED"
      ? "FREE route requested, but billing is not independently confirmed. Strict policy blocks execution."
      : source === "PAID_API"
        ? "PAID API route detected. Strict policy blocks execution."
        : "Billing source is UNKNOWN. Strict policy blocks execution.";
  chatBillingNote.textContent = `${sourceText}${budgetText} Live Chat transport: OmniRoute API. Subscription harness used by Live Chat: NO. Harness-backed work is reported separately in Provider execution receipts.`;
  chatModelSelect.dataset.billingSource = source;
  chatModelSelect.dataset.billingAllowed = source === "FREE_CONFIRMED" ? "true" : "false";
  if (chatBillingBadge) {
    chatBillingBadge.textContent = sourceLabel(source);
    chatBillingBadge.className = `billing-badge ${source.toLowerCase()}`;
    chatBillingBadge.title = sourceText;
  }
  window.dispatchEvent(new CustomEvent("koordynator:billing-change", { detail: { model, source, allowed: source === "FREE_CONFIRMED" } }));
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

function rebuildOptions(models) {
  chatModelSelect.textContent = "";
  for (const modelId of models) {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = readableModelLabel(modelId);
    option.title = `${modelId} · ${sourceLabel(sourceFor(modelId))}`;
    chatModelSelect.appendChild(option);
  }
}

async function loadChatModels() {
  if (!chatModelSelect) return;
  const fallback = chatModelSelect.value;
  try {
    const response = await fetch("/api/chat/models", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`CHAT_MODELS_HTTP_${response.status}`);
    const payload = await response.json();
    const models = safeCatalogModels(payload.models);
    if (!models.length) throw new Error("CHAT_MODEL_CATALOG_EMPTY");
    catalogBilling = payload.billing && typeof payload.billing === "object" ? payload.billing : null;

    const preferred = models.includes("auto/best-free") ? "auto/best-free" : (models.includes(fallback) ? fallback : models[0]);
    const desired = await desiredSessionModel(models, preferred);
    rebuildOptions(models);
    chatModelSelect.value = desired;
    chatModelSelect.dataset.catalog = "omniroute";
    chatModelSelect.title = `${models.length} models loaded from OmniRoute. Only FREE CONFIRMED routes execute under the default strict policy.`;
  } catch {
    catalogBilling = null;
    const models = [...chatModelSelect.options].map((option) => option.value);
    const desired = chatModelSelect.value;
    rebuildOptions(models);
    chatModelSelect.value = desired;
    chatModelSelect.dataset.catalog = "fallback";
    chatModelSelect.title = "Catalog telemetry is unavailable. Fallback routes are not billing-confirmed and strict policy blocks execution.";
  }
  billingSummary();
}

chatModelSelect?.addEventListener("change", billingSummary);
void loadChatModels();
