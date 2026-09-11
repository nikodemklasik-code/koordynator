const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  source: null,
  generating: false,
  connected: false,
  preparingAttachments: false,
  pendingAttachments: [],
  messages: new Map()
};

const SESSION_KEY = "koordynator.liveChat.sessionId";
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  zip: "application/zip",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const chatThread = $("chatThread");
const welcome = $("chatWelcome");
const input = $("messageInput");
const composer = $("composer");
const sendButton = $("sendButton");
const stopButton = $("stopButton");
const newChatButton = $("newChatButton");
const modelSelect = $("modelSelect");
const attachButton = $("attachButton");
const fileInput = $("fileInput");
const attachmentTray = $("attachmentTray");
const attachmentError = $("attachmentError");

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

function showAttachmentError(message = "") {
  attachmentError.textContent = message;
  attachmentError.classList.toggle("hidden", !message);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function resolvedMime(file) {
  const declared = String(file.type || "").toLowerCase().trim();
  if (ALLOWED_MIME_TYPES.has(declared)) return declared;
  return MIME_BY_EXTENSION[fileExtension(file.name)] || declared || "application/octet-stream";
}

function fileKindLabel(mimeType) {
  if (mimeType.startsWith("image/")) return "IMG";
  if (mimeType === "application/pdf") return "PDF";
  const subtype = mimeType.split("/")[1] || "FILE";
  if (subtype.includes("word") || subtype.includes("document")) return "DOC";
  if (subtype.includes("excel") || subtype.includes("sheet")) return "XLS";
  if (subtype.includes("powerpoint") || subtype.includes("presentation")) return "PPT";
  return "FILE";
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("ATTACHMENT_READ_FAILED"));
    reader.onerror = () => reject(reader.error || new Error("ATTACHMENT_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function totalPendingBytes() {
  return state.pendingAttachments.reduce((sum, item) => sum + item.size, 0);
}

function renderPendingAttachments() {
  attachmentTray.textContent = "";
  for (const attachment of state.pendingAttachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (attachment.mimeType.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = "";
      chip.appendChild(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-icon";
      icon.textContent = fileKindLabel(attachment.mimeType);
      chip.appendChild(icon);
    }
    const copy = document.createElement("span");
    copy.className = "attachment-copy";
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = attachment.name;
    name.title = attachment.name;
    const meta = document.createElement("span");
    meta.className = "attachment-meta";
    meta.textContent = formatBytes(attachment.size);
    copy.append(name, meta);
    const remove = document.createElement("button");
    remove.className = "attachment-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.pendingAttachments = state.pendingAttachments.filter((item) => item.clientId !== attachment.clientId);
      renderPendingAttachments();
      updateControls();
    });
    chip.append(copy, remove);
    attachmentTray.appendChild(chip);
  }
  attachmentTray.classList.toggle("hidden", state.pendingAttachments.length === 0);
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || state.generating || state.preparingAttachments) return;
  showAttachmentError("");
  if (state.pendingAttachments.length + files.length > MAX_ATTACHMENTS) {
    showAttachmentError(`Maximum ${MAX_ATTACHMENTS} attachments per message.`);
    return;
  }
  let nextTotal = totalPendingBytes();
  for (const file of files) {
    const mimeType = resolvedMime(file);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showAttachmentError(`${file.name} is larger than 10 MB.`);
      return;
    }
    nextTotal += file.size;
    if (nextTotal > MAX_ATTACHMENT_TOTAL_BYTES) {
      showAttachmentError("Attachments exceed the 20 MB total limit.");
      return;
    }
  }

  state.preparingAttachments = true;
  composer.classList.add("composer-uploading");
  updateControls();
  try {
    for (const file of files) {
      const mimeType = resolvedMime(file);
      const rawDataUrl = await readAsDataUrl(file);
      const dataUrl = `data:${mimeType};base64,${rawDataUrl.split(",")[1]}`;
      state.pendingAttachments.push({
        clientId: createClientId(),
        name: file.name,
        mimeType,
        size: file.size,
        dataUrl
      });
    }
    renderPendingAttachments();
  } catch {
    showAttachmentError("One of the files could not be read.");
  } finally {
    state.preparingAttachments = false;
    composer.classList.remove("composer-uploading");
    fileInput.value = "";
    updateControls();
  }
}

function updateControls() {
  const hasPayload = input.value.trim().length > 0 || state.pendingAttachments.length > 0;
  sendButton.disabled = !hasPayload || state.generating || state.preparingAttachments || !state.sessionId;
  stopButton.classList.toggle("hidden", !state.generating);
  newChatButton.disabled = state.generating || state.preparingAttachments;
  modelSelect.disabled = state.generating;
  attachButton.disabled = state.generating || state.preparingAttachments;
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

function renderMessageAttachments(container, attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return;
  const wrap = document.createElement("div");
  wrap.className = "message-attachments";
  for (const attachment of attachments) {
    const item = document.createElement("div");
    item.className = "message-attachment";
    if (typeof attachment.mimeType === "string" && attachment.mimeType.startsWith("image/") && typeof attachment.dataUrl === "string") {
      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = attachment.name || "Attached image";
      item.appendChild(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-icon";
      icon.textContent = fileKindLabel(String(attachment.mimeType || ""));
      item.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "message-attachment-name";
    label.textContent = `${attachment.name || "attachment"} · ${formatBytes(Number(attachment.size) || 0)}`;
    const status = { EXTRACTED: "tekst odczytany", VISION_REQUIRED: "wymaga odczytu obrazu/OCR", UNSUPPORTED: "format nieodczytany" }[attachment.extractionStatus];
    if (status) label.textContent += ` · ${status}`;
    label.title = attachment.name || "attachment";
    item.appendChild(label);
    wrap.appendChild(item);
  }
  container.appendChild(wrap);
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
  if (message.role === "assistant") {
    renderSafeMarkdown(body, message.content, message.state === "streaming");
  } else {
    body.textContent = "";
    if (message.content) {
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = message.content;
      body.appendChild(text);
    }
    renderMessageAttachments(body, message.attachments);
  }
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
    REPO_EXECUTION_DISABLED: "Uruchom serwer z KOORDYNATOR_CHAT_REPO_EXECUTION=1",
    REPO_TASK_INVALID_USE_REPO_URL_TASK: "Użyj: /repo https://github.com/owner/repo zadanie",
    REPO_EXECUTABLE_UNAVAILABLE: "Nie znaleziono git, gh lub hermes w środowisku serwera",
    REPO_COMMAND_FAILED: "Polecenie wykonawcy nie powiodło się. Sprawdź logowanie gh i instalację Hermesa.",
    CHAT_ATTACHMENT_PARSE_FAILED: "Nie udało się odczytać pliku. Może być uszkodzony lub zaszyfrowany.",
    CHAT_ATTACHMENT_PARSE_TIMEOUT: "Odczyt pliku przekroczył limit czasu",
    CHAT_ARCHIVE_LIMIT: "ZIP przekracza limit rozpakowanych danych lub liczby plików",
    CHAT_ARCHIVE_PATH_UNSAFE: "ZIP zawiera nieprawidłowe ścieżki",
    CHAT_AUTH_REQUIRED: "OmniRoute authorization unavailable",
    CHAT_RATE_LIMITED: "Rate limited",
    CHAT_TIMEOUT: "Request timed out",
    CHAT_GENERATION_IN_PROGRESS: "Already generating",
    CHAT_UNAVAILABLE: "OmniRoute unavailable",
    CHAT_ATTACHMENTS_INVALID: "Invalid attachment data",
    CHAT_ATTACHMENT_TYPE_UNSUPPORTED: "Unsupported attachment type",
    CHAT_ATTACHMENT_TOO_LARGE: "Attachment is too large",
    CHAT_ATTACHMENTS_TOO_LARGE: "Attachments are too large",
    CHAT_TOO_MANY_ATTACHMENTS: "Too many attachments"
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
  const attachments = state.pendingAttachments.map(({ name, mimeType, size, dataUrl }) => ({ name, mimeType, size, dataUrl }));
  if ((!message && attachments.length === 0) || state.generating || state.preparingAttachments || !state.sessionId) return;
  state.generating = true;
  setStatus("generating", "Generating");
  input.value = "";
  state.pendingAttachments = [];
  renderPendingAttachments();
  showAttachmentError("");
  resizeInput();
  updateControls();
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ message, model: modelSelect.value, attachments })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `CHAT_HTTP_${response.status}`);
    }
  } catch (error) {
    state.generating = false;
    const code = error instanceof Error ? error.message : "CHAT_UNAVAILABLE";
    setStatus("error", humanError(code));
    input.value = message;
    state.pendingAttachments = attachments.map((attachment) => ({ ...attachment, clientId: createClientId() }));
    renderPendingAttachments();
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
  if (state.generating || state.preparingAttachments) return;
  if (state.source) state.source.close();
  state.sessionId = null;
  state.pendingAttachments = [];
  renderPendingAttachments();
  showAttachmentError("");
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
input.addEventListener("paste", (event) => {
  const files = event.clipboardData?.files;
  if (files?.length) {
    event.preventDefault();
    void addFiles(files);
  }
});
attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => void addFiles(fileInput.files));
composer.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  composer.classList.add("drag-active");
});
composer.addEventListener("dragleave", (event) => {
  if (!composer.contains(event.relatedTarget)) composer.classList.remove("drag-active");
});
composer.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  composer.classList.remove("drag-active");
  void addFiles(event.dataTransfer.files);
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
renderPendingAttachments();
resizeInput();
