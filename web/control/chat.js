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
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
  "text/plain", "text/markdown", "text/csv", "application/json", "application/xml", "text/xml",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const MIME_BY_EXTENSION = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  xml: "application/xml", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
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
  return MIME_BY_EXTENSION[fileExtension(file.name)] || declared;
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
    if (!ALLOWED_MIME_TYPES.has(mimeType)) { showAttachmentError(`Unsupported file type: ${file.name}`); return; }
    if (file.size > MAX_ATTACHMENT_BYTES) { showAttachmentError(`${file.name} is larger than 10 MB.`); return; }
    nextTotal += file.size;
    if (nextTotal > MAX_ATTACHMENT_TOTAL_BYTES) { showAttachmentError("Attachments exceed the 20 MB total limit."); return; }
  }
  state.preparingAttachments = true;
  composer.classList.add("composer-uploading");
  updateControls();
  try {
    for (const file of files) {
      state.pendingAttachments.push({
        clientId: createClientId(), name: file.name, mimeType: resolvedMime(file), size: file.size, dataUrl: await readAsDataUrl(file)
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
  if (modelSelect.dataset.catalog === "omniroute") modelSelect.disabled = state.generating;
  attachButton.disabled = state.generating || state.preparingAttachments;
}
function applyEvent(event) {
  if (event.type === "connected") {
    state.connected = true;
    if (!state.generating) setStatus("connected", "Connected");
    return;
  }
  if (event.type === "error") {
    state.generating = false;
    setStatus("error", event.code || "Chat error");
  }
  updateControls();
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
  const selected = String(modelSelect.value || "").trim();
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(selected ? { model: selected } : {})
  });
  if (!response.ok) throw new Error(`CHAT_SESSION_HTTP_${response.status}`);
  const session = await response.json();
  state.sessionId = session.sessionId;
  localStorage.setItem(SESSION_KEY, session.sessionId);
  $("sessionLabel").textContent = shortSession(session.sessionId);
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
    setStatus("error", error instanceof Error ? error.message : "CHAT_UNAVAILABLE");
    input.value = message;
    updateControls();
  }
}
async function stopGeneration() {
  if (!state.sessionId || !state.generating) return;
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: "{}"
  });
  if (!response.ok) setStatus("error", "Stop failed");
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
}
input.addEventListener("input", updateControls);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
});
attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => void addFiles(fileInput.files));
sendButton.addEventListener("click", () => void sendMessage());
stopButton.addEventListener("click", () => void stopGeneration());
newChatButton.addEventListener("click", () => {
  if (state.source) state.source.close();
  localStorage.removeItem(SESSION_KEY);
  void createSession();
});
Promise.all([loadHealth(), restoreSession()]).catch((error) => {
  setStatus("error", error instanceof Error ? error.message : "Chat unavailable");
});
renderPendingAttachments();
updateControls();
