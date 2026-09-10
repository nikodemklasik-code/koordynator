const HISTORY_SESSION_KEY = "koordynator.liveChat.sessionId";
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const historyBackdrop = document.getElementById("historyBackdrop");
const historyCloseButton = document.getElementById("historyCloseButton");
const historyRefreshButton = document.getElementById("historyRefreshButton");
const historyNewChatButton = document.getElementById("historyNewChatButton");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");

function historyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const delta = Math.max(0, now - date.getTime());
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function historyModelLabel(value) {
  const labels = {
    "openai/gpt-5.6-sol": "GPT-5.6 Sol",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "anthropic/claude-opus-5": "Claude Opus 5"
  };
  return labels[value] || value || "model";
}

function historyIsGenerating() {
  const stop = document.getElementById("stopButton");
  return Boolean(stop && !stop.classList.contains("hidden"));
}

function closeHistory() {
  historyPanel?.classList.remove("open");
  historyPanel?.setAttribute("aria-hidden", "true");
  historyBackdrop?.classList.add("hidden");
  historyButton?.focus();
}

async function openHistory() {
  historyBackdrop?.classList.remove("hidden");
  historyPanel?.classList.add("open");
  historyPanel?.setAttribute("aria-hidden", "false");
  await loadHistory();
  historyCloseButton?.focus();
}

function renderHistory(sessions) {
  if (!historyList || !historyEmpty) return;
  historyList.textContent = "";
  const activeSession = localStorage.getItem(HISTORY_SESSION_KEY);
  historyEmpty.classList.toggle("hidden", sessions.length !== 0);

  for (const session of sessions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${session.sessionId === activeSession ? " active" : ""}`;
    button.disabled = historyIsGenerating() && session.sessionId !== activeSession;
    button.title = session.title || "New chat";

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = session.title || "New chat";

    const meta = document.createElement("span");
    meta.className = "history-item-meta";
    const model = document.createElement("span");
    model.className = "history-item-model";
    model.textContent = historyModelLabel(session.model);
    const when = document.createElement("span");
    when.textContent = historyDate(session.updatedAt);
    meta.append(model, when);

    button.append(title, meta);
    button.addEventListener("click", () => {
      if (session.sessionId === localStorage.getItem(HISTORY_SESSION_KEY)) {
        closeHistory();
        return;
      }
      if (historyIsGenerating()) return;
      localStorage.setItem(HISTORY_SESSION_KEY, session.sessionId);
      location.reload();
    });
    historyList.appendChild(button);
  }
}

async function loadHistory() {
  if (!historyList || !historyEmpty) return;
  historyList.textContent = "";
  historyEmpty.classList.add("hidden");
  const loading = document.createElement("div");
  loading.className = "history-empty";
  loading.textContent = "Loading conversations…";
  historyList.appendChild(loading);
  try {
    const response = await fetch("/api/chat/sessions?limit=100", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`CHAT_HISTORY_HTTP_${response.status}`);
    const payload = await response.json();
    renderHistory(Array.isArray(payload.sessions) ? payload.sessions : []);
  } catch {
    historyList.textContent = "";
    const failed = document.createElement("div");
    failed.className = "history-empty";
    failed.textContent = "Chat history could not be loaded.";
    historyList.appendChild(failed);
  }
}

historyButton?.addEventListener("click", () => void openHistory());
historyCloseButton?.addEventListener("click", closeHistory);
historyBackdrop?.addEventListener("click", closeHistory);
historyRefreshButton?.addEventListener("click", () => void loadHistory());
historyNewChatButton?.addEventListener("click", () => {
  if (historyIsGenerating()) return;
  closeHistory();
  document.getElementById("newChatButton")?.click();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && historyPanel?.classList.contains("open")) closeHistory();
});
