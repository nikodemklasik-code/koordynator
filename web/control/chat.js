const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  source: null,
  generating: false,
  connected: false,
  messages: new Map()
};

const SESSION_KEY = "koordynator.liveChat.sessionId";
const chatThread = $("chatThread");
const welcome = $("chatWelcome");
const input = $("messageInput");
const sendButton = $("sendButton");
const stopButton = $("stopButton");
const newChatButton = $("newChatButton");
const modelSelect = $("modelSelect");

function nearBottom() {
  return chatThread.scrollHeight - chatThread.scrollTop - chatThread.clientHeight < 120;
}

function scrollBottom(force = false) {
  if (force || nearBottom()) chatThread.scrollTop = chatThread.scrollHeight;
}

function shortSession(value) {
  if (!value) return "creating…";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function modelLabel(value) {
  const labels = {
    "openai/gpt-5.6-sol": "GPT-5.6 Sol",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "anthropic/claude-opus-5": "Claude Opus 5"
  };
  return labels[value] || value;
}

function setStatus(kind, text) {
  $("statusText").textContent = text;
  $("statusDot").className = `chat-status-dot ${kind}`;
  $("footerConnection").textContent = text.toUpperCase();
}

function updateControls() {
  const hasText = input.value.trim().length > 0;
  sendButton.disabled = !hasText || state.generating || !state.sessionId;
  stopButton.classList.toggle("hidden", !state.generating);
  newChatButton.disabled = state.generating;
  modelSelect.disabled = state.generating;
}

function textBlock(text) {
  const fragment = document.createDocumentFragment();
  const lines = text.split("\n");
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    p.textContent = paragraph.join("\n");
    p.style.whiteSpace = "pre-wrap";
    fragment.appendChild(p);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    fragment.appendChild(list);
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      const h = document.createElement(`h${heading[1].length}`);
      h.textContent = heading[2];
      fragment.appendChild(h);
    } else if (bullet || ordered) {
      flushParagraph();
      const tag = ordered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        flushList();
        list = document.createElement(tag);
      }
      const li = document.createElement("li");
      li.textContent = (bullet || ordered)[1];
      list.appendChild(li);
    } else if (line.trim() === "") {
      flushParagraph(); flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph(); flushList();
  return fragment;
}

function renderSafeMarkdown(container, content, streaming) {
  container.textContent = "";
  const parts = content.split("```");
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const firstBreak = part.indexOf("\n");
      const code = firstBreak >= 0 ? part.slice(firstBreak + 1) : part;
      const pre = document.createElement("pre");
      const codeNode = document.createElement("code");
      codeNode.textContent = code;
      pre.appendChild(codeNode);
      container.appendChild(pre);
    } else if (part) {
      container.appendChild(textBlock(part));
    }
  });
  if (streaming) {
    const caret = document.createElement("span");
    caret.className = "stream-caret";
    caret.setAttribute("aria-hidden", "true");
    container.appendChild(caret);
  }
}

function renderMessage(message) {
  const shouldFollow = nearBottom();
  let article = chatThread.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (!article) {
    article = document.createElement("article");
    article.className = `chat-message ${message.role}`;
    article.dataset.messageId = message.id;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.role === "user" ? "YOU" : "KOORDYNATOR";
    meta.appendChild(author);
    if (message.model && message.role === "assistant") {
      const model = document.createElement("span");
      model.className = "message-model";
      model.textContent = modelLabel(message.model);
      meta.appendChild(model);
    }
    const body = document.createElement("div");
    body.className = "message-bubble";
    const status = document.createElement("div");
    status.className = "message-state";
    article.append(meta, body, status);
    chatThread.appendChild(article);
  }
  const body = article.querySelector(".message-bubble");
  const status = article.querySelector(".message-state");
  if (message.role === "assistant") renderSafeMarkdown(body, message.content, message.state === "streaming");
  else body.textContent = message.content;
  status.className = `message-state ${message.state}`;
  status.textContent = message.state === "stopped" ? "Generation stopped" : message.state === "error" ? "Generation failed" : "";
  welcome.classList.add("hidden");
  if (shouldFollow) scrollBottom(true);
}

function renderTranscript(messages) {
  state.messages.clear();
  chatThread.querySelectorAll(".chat-message").forEach((node) => node.remove());
  welcome.classList.toggle("hidden", messages.length > 0);
  for (const message of messages) {
    state.messages.set(message.id, { ...message });
    renderMessage(message);
  }
  if (messages.length) scrollBottom(true);
}

function applyEvent(event) {
  if (event.type === "connected") {
    state.connected = true;
    if (!state.generating) setStatus("connected", "Connected");
    return;
  }
  if (event.type === "user_message" || event.type === "assistant_start" || event.type === "assistant_done" || event.type === "stopped") {
    const message = { ...event.message };
    state.messages.set(message.id, message);
    renderMessage(message);
  }
  if (event.type === "assistant_start") {
    state.generating = true;
    setStatus("generating", "Generating");
  } else if (event.type === "assistant_delta") {
    const message = state.messages.get(event.messageId);
    if (message) {
      message.content += event.delta;
      message.state = "streaming";
      renderMessage(message);
    }
  } else if (event.type === "assistant_done") {
    state.generating = false;
    setStatus("connected", "Connected");
  } else if (event.type === "stopped") {
    state.generating = false;
    setStatus("stopped", "Stopped");
  } else if (event.type === "error") {
    state.generating = false;
    setStatus("error", humanError(event.code));
  }
  updateControls();
}

function humanError(code) {
  const known = {
    CHAT_AUTH_REQUIRED: "OmniRoute authorization unavailable",
    CHAT_RATE_LIMITED: "Rate limited",
    CHAT_TIMEOUT: "Request timed out",
    CHAT_GENERATION_IN_PROGRESS: "Already generating",
    CHAT_UNAVAILABLE: "OmniRoute unavailable"
  };
  return known[code] || "Chat error";
}

function connectEvents() {
  if (state.source) state.source.close();
  state.connected = false;
  setStatus("", "Connecting");
  const source = new EventSource(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/events`);
  state.source = source;
  source.onmessage = (event) => {
    try { applyEvent(JSON.parse(event.data)); } catch { setStatus("error", "Invalid stream event"); }
  };
  source.onerror = () => {
    state.connected = false;
    if (!state.generating) setStatus("error", "Connection lost");
  };
}

async function createSession() {
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ model: modelSelect.value })
  });
  if (!response.ok) throw new Error(`CHAT_SESSION_HTTP_${response.status}`);
  const session = await response.json();
  state.sessionId = session.sessionId;
  localStorage.setItem(SESSION_KEY, session.sessionId);
  $("sessionLabel").textContent = shortSession(session.sessionId);
  renderTranscript([]);
  connectEvents();
  updateControls();
}

async function restoreSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return createSession();
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(saved)}`, { headers: { accept: "application/json" } });
  if (response.status === 404 || response.status === 400) {
    localStorage.removeItem(SESSION_KEY);
    return createSession();
  }
  if (!response.ok) throw new Error(`CHAT_SESSION_HTTP_${response.status}`);
  const session = await response.json();
  state.sessionId = session.sessionId;
  $("sessionLabel").textContent = shortSession(session.sessionId);
  if ([...modelSelect.options].some((option) => option.value === session.model)) modelSelect.value = session.model;
  renderTranscript(session.messages || []);
  connectEvents();
  updateControls();
}

async function sendMessage() {
  const message = input.value.trim();
  if (!message || state.generating || !state.sessionId) return;
  state.generating = true;
  setStatus("generating", "Generating");
  input.value = "";
  resizeInput();
  updateControls();
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ message, model: modelSelect.value })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `CHAT_HTTP_${response.status}`);
    }
  } catch (error) {
    state.generating = false;
    setStatus("error", humanError(error instanceof Error ? error.message : "CHAT_UNAVAILABLE"));
    input.value = message;
    resizeInput();
    updateControls();
  }
}

async function stopGeneration() {
  if (!state.sessionId || !state.generating) return;
  stopButton.disabled = true;
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}"
    });
    if (!response.ok) throw new Error(`CHAT_STOP_HTTP_${response.status}`);
  } catch {
    setStatus("error", "Stop failed");
  } finally {
    stopButton.disabled = false;
  }
}

async function newConversation() {
  if (state.generating) return;
  if (state.source) state.source.close();
  state.sessionId = null;
  localStorage.removeItem(SESSION_KEY);
  $("sessionLabel").textContent = "creating…";
  setStatus("", "Creating session");
  await createSession();
  input.focus();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  updateControls();
}

async function loadHealth() {
  const response = await fetch("/api/health", { headers: { accept: "application/json" } });
  if (!response.ok) return;
  const health = await response.json();
  $("environmentLabel").textContent = health.environment;
  $("sidebarEnv").textContent = health.environment;
  $("operatorLabel").textContent = health.operator;
  $("regionLabel").textContent = health.region;
  $("zoneLabel").textContent = health.zone;
  $("versionLabel").textContent = `v${health.version}`;
  $("ciStatus").textContent = health.ciVerify;
  $("ciStatus").className = `status-badge ${health.ciVerify === "PASS" ? "pass" : health.ciVerify === "FAIL" ? "fail" : "neutral"}`;
  $("ciRing").className = `status-ring ${health.ciVerify === "PASS" ? "pass" : health.ciVerify === "FAIL" ? "fail" : ""}`;
}

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
});
sendButton.addEventListener("click", () => void sendMessage());
stopButton.addEventListener("click", () => void stopGeneration());
newChatButton.addEventListener("click", () => void newConversation());
window.addEventListener("beforeunload", () => state.source?.close());

Promise.all([loadHealth(), restoreSession()]).catch((error) => {
  state.generating = false;
  setStatus("error", error instanceof Error ? error.message : "Chat unavailable");
  updateControls();
});
resizeInput();
