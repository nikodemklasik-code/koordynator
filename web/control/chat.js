const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  source: null,
  generating: false,
  connected: false,
  preparingAttachments: false,
  stageZeroRunning: false,
  hermesMuted: false,
  hermesSessionId: null,
  hermesSource: null,
  pendingAttachments: [],
  messages: new Map()
};

const SESSION_KEY = "koordynator.liveChat.sessionId";
const urlParams = new URLSearchParams(window.location.search);
const pinnedSessionId = urlParams.get("session");
const isPopoutWindow = urlParams.get("popout") === "1" || Boolean(pinnedSessionId);
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
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  yml: "text/plain",
  yaml: "text/plain",
  toml: "text/plain",
  ini: "text/plain",
  cfg: "text/plain",
  conf: "text/plain",
  env: "text/plain",
  log: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  mjs: "text/plain",
  cjs: "text/plain",
  py: "text/plain",
  rb: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  swift: "text/plain",
  php: "text/plain",
  sql: "text/plain",
  html: "text/plain",
  htm: "text/plain",
  css: "text/plain",
  scss: "text/plain",
  less: "text/plain",
  sh: "text/plain",
  bash: "text/plain",
  zsh: "text/plain",
  ps1: "text/plain",
  dockerfile: "text/plain",
  gitignore: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
const TEXTUAL_EXTENSIONS = new Set(Object.entries(MIME_BY_EXTENSION)
  .filter(([, mime]) => mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || mime === "application/json" || mime === "application/xml" || mime === "text/xml")
  .map(([ext]) => ext));

const chatFrame = $("chatFrame");
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
const popoutChatButton = $("popoutChatButton");
const exportMdButton = $("exportMdButton");
const exportPdfButton = $("exportPdfButton");
const exportZipButton = $("exportZipButton");
const stageZeroButton = $("stageZeroButton");
const stageZeroNotice = $("stageZeroNotice");
const muteHermesButton = $("muteHermesButton");
const startHermesButton = $("startHermesButton");
const stopHermesButton = $("stopHermesButton");
const hermesPane = $("hermesPane");
const hermesTerm = $("hermesTerm");
const hermesInput = $("hermesInput");
const sendHermesButton = $("sendHermesButton");
const hermesState = $("hermesState");
const hermesHint = $("hermesHint");
const MUTE_KEY = "koordynator.liveChat.hermesMuted";
let hermesXterm = null;
let hermesFit = null;
let dragDepth = 0;

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
  if (declared.startsWith("text/")) return "text/plain";
  const byExt = MIME_BY_EXTENSION[fileExtension(file.name)];
  if (byExt) return byExt;
  if (TEXTUAL_EXTENSIONS.has(fileExtension(file.name)) || TEXTUAL_EXTENSIONS.has(file.name.toLowerCase())) return "text/plain";
  return declared || "application/octet-stream";
}

function extractGithubUrls(text) {
  const matches = String(text || "").match(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/\.git$/i, "")))];
}

function setDropActive(active) {
  if (!chatFrame) return;
  chatFrame.classList.toggle("drag-active", active);
  composer.classList.toggle("drag-active", active);
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

async function handleDroppedPayload(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  const text = dataTransfer?.getData("text/uri-list") || dataTransfer?.getData("text/plain") || "";
  const githubUrls = extractGithubUrls(text);
  if (files.length) await addFiles(files);
  if (githubUrls.length) {
    const existing = input.value.trim();
    const next = githubUrls.join("\n");
    input.value = existing ? `${existing}\n${next}` : `Please review this GitHub repository:\n${next}`;
    resizeInput();
    if (typeof window.koordynatorRequestGithubConsent === "function") {
      window.koordynatorRequestGithubConsent("GitHub repository detected. Approve access to continue.");
    } else {
      const notice = document.getElementById("githubChatNotice");
      if (notice) {
        notice.textContent = "GitHub repository detected. Approve access if prompted.";
        notice.className = "github-chat-notice pending";
      }
    }
  }
}

function updateControls() {
  const hasPayload = input.value.trim().length > 0 || state.pendingAttachments.length > 0;
  sendButton.disabled = !hasPayload || state.generating || state.preparingAttachments || !state.sessionId;
  stopButton.classList.toggle("hidden", !state.generating);
  newChatButton.disabled = state.generating || state.preparingAttachments;
  modelSelect.disabled = state.generating;
  attachButton.disabled = state.generating || state.preparingAttachments;
  if (stageZeroButton) stageZeroButton.disabled = state.generating || state.preparingAttachments || !state.sessionId || state.stageZeroRunning;
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

async function copyText(value, button) {
  const text = String(value || "");
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    if (button) {
      const previous = button.textContent;
      button.textContent = "Copied";
      button.classList.add("copied");
      window.setTimeout(() => {
        button.textContent = previous || "Copy";
        button.classList.remove("copied");
      }, 1200);
    }
  } catch {
    if (button) {
      button.textContent = "Failed";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    }
  }
}

function createCopyButton(label, getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = label === "Copy message" ? "message-copy" : "code-copy";
  button.textContent = label === "Copy message" ? "Copy" : "Copy";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void copyText(getText(), button);
  });
  return button;
}

function renderSafeMarkdown(container, content, streaming) {
  container.textContent = "";
  const parts = content.split("```");
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const firstBreak = part.indexOf("\n");
      const language = firstBreak >= 0 ? part.slice(0, firstBreak).trim() : "";
      const code = firstBreak >= 0 ? part.slice(firstBreak + 1) : part;
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      const pre = document.createElement("pre");
      const codeNode = document.createElement("code");
      codeNode.textContent = code.replace(/\n$/, "");
      if (language) codeNode.dataset.language = language;
      pre.appendChild(codeNode);
      wrap.append(createCopyButton("Copy code", () => codeNode.textContent || ""), pre);
      container.appendChild(wrap);
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

const PLAN_MARKER_RE = /(?:^|\n)\s*(?:PLAN\s+UZGODNIONY|AGREED\s+PLAN)\s*(?:\n|$)/i;

/** Mirrors the server's plan check well enough to decide whether to offer the button. */
function looksLikePlan(content) {
  const text = String(content || "");
  if (!PLAN_MARKER_RE.test(text)) return false;
  const has = (labels) => labels.some((label) =>
    new RegExp(`(?:^|\\n)\\s*${label}\\s*:`, "i").test(text));
  return has(["cel", "objective", "goal"]) &&
    has(["moduły", "moduly", "modules", "moduł", "modul", "module"]) &&
    has(["ścieżki", "sciezki", "paths", "allowedpaths"]) &&
    has(["kryteria akceptacji", "kryteria", "acceptance criteria", "acceptance"]);
}

function createMaterialiseButton(message) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-materialise";
  button.textContent = "Materializuj";
  button.title = "Utwórz podpisane zadanie w Tasks z tego planu";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = state.messages.get(message.id);
    const plan = current?.content || "";
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Materializuję…";
    try {
      const response = await fetch("/api/tasks/materialise-plan", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ plan })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      button.textContent = `✓ ${payload.taskId}`;
      button.classList.add("done");
      button.title = `Zadanie ${payload.taskId} utworzone — otwórz Tasks`;
      if (current) current.materialisedTaskId = payload.taskId;
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      button.classList.add("failed");
      button.title = error instanceof Error ? error.message : "Materializacja nie powiodła się";
      setTimeout(() => button.classList.remove("failed"), 2500);
    }
  });
  return button;
}

/** Adds/updates/removes the Materialise control as streamed content changes. */
function syncMaterialiseButton(article, message) {
  if (message.role !== "assistant") return;
  const meta = article.querySelector(".message-meta");
  if (!meta) return;
  const existing = meta.querySelector(".message-materialise");

  if (message.materialisedTaskId) {
    const button = existing || createMaterialiseButton(message);
    button.disabled = true;
    button.classList.add("done");
    button.textContent = `✓ ${message.materialisedTaskId}`;
    button.title = `Zadanie ${message.materialisedTaskId} utworzone`;
    if (!existing) meta.appendChild(button);
    return;
  }
  // Only offer it once the turn has finished and the text really is a plan.
  const eligible = message.state === "complete" && looksLikePlan(message.content);
  if (eligible && !existing) meta.appendChild(createMaterialiseButton(message));
  if (!eligible && existing) existing.remove();
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
    const copyMessage = createCopyButton("Copy message", () => {
      const current = state.messages.get(message.id);
      return current?.content || "";
    });
    meta.appendChild(copyMessage);
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
  syncMaterialiseButton(article, message);
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
    CHAT_RATE_LIMITED: "Rate limited — try another model or wait for quota reset",
    CHAT_TIMEOUT: "Request timed out",
    CHAT_GENERATION_IN_PROGRESS: "Already generating",
    CHAT_UNAVAILABLE: "OmniRoute unavailable",
    CHAT_ATTACHMENTS_INVALID: "Invalid attachment data",
    CHAT_ATTACHMENT_TYPE_UNSUPPORTED: "Unsupported attachment type",
    CHAT_ATTACHMENT_TOO_LARGE: "Attachment is too large",
    CHAT_ATTACHMENTS_TOO_LARGE: "Attachments are too large",
    CHAT_TOO_MANY_ATTACHMENTS: "Too many attachments",
    CHAT_BILLING_FREE_UNCONFIRMED: "This free route is not confirmed yet — pick Claude/Grok/Codex",
    CHAT_BILLING_UNKNOWN_BLOCKED: "This model is blocked by billing policy — pick an executable route",
    CHAT_BILLING_PAID_API_BLOCKED: "Paid API route blocked — use subscription/free OmniRoute models",
    CHAT_BILLING_BUDGET_EXHAUSTED: "Paid API budget exhausted",
    CHAT_UPSTREAM_400: "Model rejected the attachment format",
    CHAT_UPSTREAM_429: "Upstream rate limited — try another model"
  };
  if (known[code]) return known[code];
  if (typeof code === "string" && code.startsWith("CHAT_UPSTREAM_")) return `Upstream error (${code.slice("CHAT_UPSTREAM_".length)})`;
  return "Chat error";
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

async function createSession({ persist = !isPopoutWindow } = {}) {
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ model: modelSelect.value })
  });
  if (!response.ok) throw new Error(`CHAT_SESSION_HTTP_${response.status}`);
  const session = await response.json();
  state.sessionId = session.sessionId;
  if (persist) localStorage.setItem(SESSION_KEY, session.sessionId);
  $("sessionLabel").textContent = shortSession(session.sessionId);
  renderTranscript([]);
  connectEvents();
  updateControls();
  return session;
}

async function loadSessionById(sessionId, { persist = false } = {}) {
  const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(`CHAT_SESSION_HTTP_${response.status}`);
  const session = await response.json();
  state.sessionId = session.sessionId;
  if (persist) localStorage.setItem(SESSION_KEY, session.sessionId);
  $("sessionLabel").textContent = shortSession(session.sessionId);
  if ([...modelSelect.options].some((option) => option.value === session.model)) modelSelect.value = session.model;
  renderTranscript(session.messages || []);
  connectEvents();
  updateControls();
  return session;
}

async function restoreSession() {
  if (pinnedSessionId) {
    const loaded = await loadSessionById(pinnedSessionId, { persist: false });
    if (loaded) return loaded;
    return createSession({ persist: false });
  }
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return createSession();
  const loaded = await loadSessionById(saved, { persist: true });
  if (loaded) return loaded;
  localStorage.removeItem(SESSION_KEY);
  return createSession();
}

function conversationPlainText() {
  return [...state.messages.values()]
    .map((message) => `${message.role === "user" ? "YOU" : "KOORDYNATOR"}:\n${message.content || ""}`)
    .join("\n\n")
    .trim();
}

function buildMarkdownExport() {
  const lines = [`# Koordynator Live Chat`, "", `- Session: \`${state.sessionId || "unknown"}\``, `- Model: \`${modelSelect.value || "unknown"}\``, ""];
  for (const message of state.messages.values()) {
    lines.push(`## ${message.role === "user" ? "You" : "Koordynator"}`);
    lines.push("");
    lines.push(message.content || "_(empty)_");
    lines.push("");
  }
  return lines.join("\n");
}

function escapePdfText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdfExport(text) {
  const lines = String(text || "Empty conversation").split(/\r?\n/).slice(0, 80);
  const content = ["BT", "/F1 10 Tf", "50 780 Td"];
  lines.forEach((line, index) => {
    if (index > 0) content.push("0 -14 Td");
    content.push(`(${escapePdfText(line.slice(0, 100))}) Tj`);
  });
  content.push("ET");
  const stream = content.join("\n");
  const objects = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objects.push("3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n");
  objects.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`);
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildZipExport(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ]);
    localParts.push(localHeader, data);
    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const central = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0)
  ]);
  return concatBytes([...localParts, central, end]);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function setStageZeroNotice(kind, text) {
  if (!stageZeroNotice) return;
  if (!text) {
    stageZeroNotice.className = "stage-zero-notice hidden";
    stageZeroNotice.textContent = "";
    return;
  }
  stageZeroNotice.className = `stage-zero-notice ${kind || ""}`;
  stageZeroNotice.textContent = text;
}

function stageZeroSummary(run) {
  const decision = run?.reading?.decision;
  const status = decision?.status || "unknown";
  if (status === "allow") {
    const count = run.roadmap?.milestones?.length || 0;
    return `Etap 0 ALLOW — Mózg spisał ${count} kamieni. Harmonia: ${(run.reading?.understanding || "").slice(0, 180)}`;
  }
  if (status === "deny") {
    return `Etap 0 DENY (${decision.reason || "cardinal_issue"}) — wraca do autora. Mapa nie powstała.`;
  }
  if (status === "pause") {
    return `Etap 0 PAUSE (${decision.reason || "tension"}) — poznanie niedomknięte, mapa nie powstała.`;
  }
  return `Etap 0: ${status}`;
}

async function runStageZero() {
  if (!state.sessionId || state.generating || state.stageZeroRunning) return;
  state.stageZeroRunning = true;
  updateControls();
  setStageZeroNotice("pending", "Etap 0: Harmonia czyta tę rozmowę…");
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/stage-zero`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    setStageZeroNotice(payload.reading?.decision?.status === "allow" ? "ok" : "warn", stageZeroSummary(payload));
  } catch (error) {
    setStageZeroNotice("error", error instanceof Error ? error.message : "STAGE_ZERO_FAILED");
  } finally {
    state.stageZeroRunning = false;
    updateControls();
  }
}

function setHermesState(label) {
  if (hermesState) hermesState.textContent = label;
}

function applyHermesMute() {
  document.body.classList.toggle("chat-hermes-muted", state.hermesMuted);
  if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż terminal" : "Wycisz terminal";
  if (!state.hermesMuted) {
    requestAnimationFrame(() => {
      try { hermesFit?.fit(); } catch { /* ignore */ }
    });
  }
}

function toggleHermesMute() {
  state.hermesMuted = !state.hermesMuted;
  try { localStorage.setItem(MUTE_KEY, state.hermesMuted ? "1" : "0"); } catch { /* private mode */ }
  applyHermesMute();
}

function hermesFitAddon() {
  const exported = typeof FitAddon === "undefined" ? null : FitAddon;
  if (!exported) return null;
  const Ctor = exported.FitAddon || exported;
  try { return new Ctor(); } catch { return null; }
}

function ensureHermesTerminal() {
  if (hermesXterm) return hermesXterm;
  if (!hermesTerm || typeof Terminal !== "function") return null;
  hermesXterm = new Terminal({
    convertEol: true,
    cursorBlink: true,
    disableStdin: false,
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    theme: { background: "#070b0e", foreground: "#d7e8f4", cursor: "#8ac5ff" }
  });
  hermesFit = hermesFitAddon();
  if (hermesFit) hermesXterm.loadAddon(hermesFit);
  hermesXterm.open(hermesTerm);
  hermesXterm.onData((data) => { void sendHermesInput(data); });
  try { hermesFit?.fit(); } catch { /* not yet measured */ }
  return hermesXterm;
}

function appendHermesOutput(text) {
  if (!text) return;
  const term = ensureHermesTerminal();
  if (term) {
    term.write(text);
    return;
  }
  if (!hermesTerm) return;
  hermesTerm.textContent += text;
}

async function sendHermesInput(data) {
  if (!state.hermesSessionId || !data) return;
  await fetch(`/api/hermes/pty/${encodeURIComponent(state.hermesSessionId)}/input`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ data })
  });
}

async function sendHermesLine() {
  const text = hermesInput?.value ?? "";
  if (!text.trim()) return;
  if (!state.hermesSessionId) {
    if (hermesHint) hermesHint.textContent = "Najpierw Start Hermes.";
    return;
  }
  hermesInput.value = "";
  await sendHermesInput(`${text}\r`);
}

function connectHermesEvents(sessionId) {
  state.hermesSource?.close();
  const source = new EventSource(`/api/hermes/pty/${encodeURIComponent(sessionId)}/events`);
  state.hermesSource = source;
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "out") appendHermesOutput(payload.text);
      if (payload.type === "exit") {
        setHermesState("OFF");
        state.hermesSessionId = null;
        if (hermesHint) hermesHint.textContent = `Hermes ended (${payload.code}). Start again to attach a new PTY.`;
      }
    } catch { /* ignore */ }
  };
  source.onerror = () => setHermesState(state.hermesSessionId ? "LIVE" : "OFF");
}

function hermesDimensions() {
  const term = ensureHermesTerminal();
  try { hermesFit?.fit(); } catch { /* ignore */ }
  if (term?.cols && term?.rows) return { cols: term.cols, rows: term.rows };
  return {
    cols: Math.max(40, Math.floor((hermesTerm?.clientWidth || 480) / 8)),
    rows: Math.max(12, Math.floor((hermesTerm?.clientHeight || 240) / 16))
  };
}

async function startHermesPty() {
  setHermesState("STARTING");
  if (hermesHint) hermesHint.textContent = "Starting Hermes PTY…";
  try {
    const term = ensureHermesTerminal();
    term?.reset();
    const { cols, rows } = hermesDimensions();
    const response = await fetch("/api/hermes/pty", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cols, rows })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    state.hermesSessionId = payload.sessionId;
    connectHermesEvents(payload.sessionId);
    setHermesState("LIVE");
    if (hermesHint) hermesHint.textContent = "Click the terminal and type. This is Hermes, not Live Chat.";
    term?.focus();
  } catch (error) {
    setHermesState("OFF");
    if (hermesHint) hermesHint.textContent = error instanceof Error ? error.message : "HERMES_PTY_FAILED";
  }
}

async function stopHermesPty() {
  const sessionId = state.hermesSessionId;
  if (!sessionId) return;
  await fetch(`/api/hermes/pty/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  }).catch(() => {});
  state.hermesSource?.close();
  state.hermesSource = null;
  state.hermesSessionId = null;
  setHermesState("OFF");
}

function exportConversation(kind) {
  if (!state.messages.size) {
    setStatus("error", "Nothing to export yet");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `koordynator-chat-${(state.sessionId || "session").slice(0, 8)}-${stamp}`;
  const markdown = buildMarkdownExport();
  if (kind === "md") {
    downloadBlob(`${base}.md`, new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    return;
  }
  if (kind === "pdf") {
    downloadBlob(`${base}.pdf`, new Blob([buildPdfExport(conversationPlainText())], { type: "application/pdf" }));
    return;
  }
  if (kind === "zip") {
    const zip = buildZipExport([
      { name: "conversation.md", content: markdown },
      { name: "conversation.txt", content: conversationPlainText() },
      { name: "meta.json", content: JSON.stringify({ sessionId: state.sessionId, model: modelSelect.value, exportedAt: new Date().toISOString() }, null, 2) }
    ]);
    downloadBlob(`${base}.zip`, new Blob([zip], { type: "application/zip" }));
  }
}

function openPopoutChat() {
  const target = new URL("/chat", window.location.origin);
  target.searchParams.set("popout", "1");
  // Fresh independent conversation window (do not pin current session).
  window.open(target.toString(), `koord-chat-${Date.now()}`, "popup=yes,width=1180,height=860");
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
  if (!isPopoutWindow) localStorage.removeItem(SESSION_KEY);
  $("sessionLabel").textContent = "creating…";
  setStatus("", "Creating session");
  await createSession({ persist: !isPopoutWindow });
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

function isFileDrag(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
}

if (chatFrame) {
  chatFrame.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setDropActive(true);
  });
  chatFrame.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  });
  chatFrame.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDropActive(false);
  });
  chatFrame.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setDropActive(false);
    void handleDroppedPayload(event.dataTransfer);
  });
}

sendButton.addEventListener("click", () => void sendMessage());
stopButton.addEventListener("click", () => void stopGeneration());
newChatButton.addEventListener("click", () => void newConversation());
popoutChatButton?.addEventListener("click", () => openPopoutChat());
stageZeroButton?.addEventListener("click", () => void runStageZero());
muteHermesButton?.addEventListener("click", () => toggleHermesMute());
startHermesButton?.addEventListener("click", () => void startHermesPty());
stopHermesButton?.addEventListener("click", () => void stopHermesPty());
sendHermesButton?.addEventListener("click", () => void sendHermesLine());
hermesInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendHermesLine();
  }
});
window.addEventListener("resize", () => {
  if (!state.hermesSessionId) return;
  const { cols, rows } = hermesDimensions();
  void fetch(`/api/hermes/pty/${encodeURIComponent(state.hermesSessionId)}/resize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols, rows })
  });
});
window.addEventListener("beforeunload", () => { state.source?.close(); state.hermesSource?.close(); });
exportMdButton?.addEventListener("click", () => exportConversation("md"));
exportPdfButton?.addEventListener("click", () => exportConversation("pdf"));
exportZipButton?.addEventListener("click", () => exportConversation("zip"));

try { state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch { state.hermesMuted = false; }
applyHermesMute();

Promise.all([loadHealth(), restoreSession()]).catch((error) => {
  state.generating = false;
  setStatus("error", error instanceof Error ? error.message : "Chat unavailable");
  updateControls();
});
renderPendingAttachments();
resizeInput();
