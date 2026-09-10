const chatModelSelect = document.getElementById("modelSelect");
const CHAT_MODEL_SESSION_KEY = "koordynator.liveChat.sessionId";

function readableModelLabel(modelId) {
  const known = {
    "openai/gpt-5.6-sol": "GPT-5.6 Sol",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "anthropic/claude-opus-5": "Claude Opus 5"
  };
  if (known[modelId]) return known[modelId];
  const slash = modelId.indexOf("/");
  if (slash < 0) return modelId;
  const provider = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  return `${model} · ${provider}`;
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

async function loadChatModels() {
  if (!chatModelSelect) return;
  const fallback = chatModelSelect.value;
  try {
    const response = await fetch("/api/chat/models", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`CHAT_MODELS_HTTP_${response.status}`);
    const payload = await response.json();
    const models = safeCatalogModels(payload.models);
    if (!models.length) throw new Error("CHAT_MODEL_CATALOG_EMPTY");

    const desired = await desiredSessionModel(models, models.includes(fallback) ? fallback : models[0]);
    chatModelSelect.textContent = "";
    for (const modelId of models) {
      const option = document.createElement("option");
      option.value = modelId;
      option.textContent = readableModelLabel(modelId);
      option.title = modelId;
      chatModelSelect.appendChild(option);
    }
    chatModelSelect.value = desired;
    chatModelSelect.dataset.catalog = "omniroute";
    chatModelSelect.title = `${models.length} models loaded from OmniRoute`;
  } catch {
    chatModelSelect.dataset.catalog = "fallback";
    chatModelSelect.title = "Using fallback model list because the OmniRoute catalog is unavailable";
  }
}

void loadChatModels();
