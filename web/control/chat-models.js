const chatModelSelect = document.getElementById("modelSelect");
const chatBillingNote = document.querySelector(".composer-note");
const CHAT_MODEL_SESSION_KEY = "koordynator.liveChat.sessionId";
let catalogBilling = null;

function freeLike(modelId) {
  return /(?:^|[\/:._-])(?:best-)?free(?:$|[\/:._-])/i.test(modelId);
}

function sourceFor(modelId) {
  const explicit = catalogBilling?.modelSources?.[modelId];
  if (["FREE_ROUTE", "PAID_API", "UNKNOWN"].includes(explicit)) return explicit;
  return freeLike(modelId) ? "FREE_ROUTE" : "UNKNOWN";
}

function sourceLabel(source) {
  if (source === "FREE_ROUTE") return "FREE ROUTE";
  if (source === "PAID_API") return "PAID API";
  return "API COST UNKNOWN";
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
  const sourceText = source === "FREE_ROUTE"
    ? "FREE route requested."
    : source === "PAID_API"
      ? "PAID API route. This can consume paid API budget."
      : "API billing cost is UNKNOWN. Do not treat it as free.";
  chatBillingNote.textContent = `${sourceText}${budgetText} Subscription harness used by Live Chat: NO. Harness-backed work is reported separately in Provider execution receipts.`;
  chatModelSelect.dataset.billingSource = source;
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
    chatModelSelect.title = `${models.length} models loaded from OmniRoute. Subscription harness is not used by Live Chat.`;
  } catch {
    catalogBilling = null;
    const models = [...chatModelSelect.options].map((option) => option.value);
    const desired = chatModelSelect.value;
    rebuildOptions(models);
    chatModelSelect.value = desired;
    chatModelSelect.dataset.catalog = "fallback";
    chatModelSelect.title = "Using fallback model list. Best free route is the safe default; named routes have unknown API billing until catalog telemetry is available.";
  }
  billingSummary();
}

chatModelSelect?.addEventListener("change", billingSummary);
void loadChatModels();
