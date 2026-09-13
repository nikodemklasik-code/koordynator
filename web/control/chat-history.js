const HISTORY_SESSION_KEY = "koordynator.liveChat.sessionId";
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const historyBackdrop = document.getElementById("historyBackdrop");
const historyCloseButton = document.getElementById("historyCloseButton");
const historyRefreshButton = document.getElementById("historyRefreshButton");
const historyNewChatButton = document.getElementById("historyNewChatButton");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");

const selectedResponseIds = new Set();
const selectedAttachmentIds = new Set();
let selectionSessionId = null;
let selectorDialog = null;
let selectorMode = "export";
let responseSyncScheduled = false;

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

function exportsBySession(receipts) {
  const grouped = new Map();
  for (const receipt of receipts || []) {
    if (!receipt?.sessionId) continue;
    const list = grouped.get(receipt.sessionId) || [];
    list.push(receipt);
    grouped.set(receipt.sessionId, list);
  }
  return grouped;
}

function renderGeneratedFiles(receipts) {
  const wrap = document.createElement("div");
  wrap.className = "history-item-meta";
  const title = document.createElement("strong");
  title.textContent = "GENERATED FILES";
  wrap.appendChild(title);
  const files = receipts.flatMap((receipt) => (receipt.files || []).map((file) => ({ receipt, file }))).slice(0, 8);
  for (const { receipt, file } of files) {
    const row = document.createElement("span");
    row.textContent = `${historyDate(receipt.createdAt)} · ${file.kind} · ${file.name}`;
    row.title = file.path || "";
    wrap.appendChild(row);
  }
  const latest = receipts[0];
  if (latest?.directory) {
    const saved = document.createElement("span");
    saved.textContent = `Saved: ${latest.directory}`;
    saved.title = latest.directory;
    wrap.appendChild(saved);
  }
  return wrap;
}

function renderHistory(sessions, receipts = []) {
  if (!historyList || !historyEmpty) return;
  historyList.textContent = "";
  const activeSession = localStorage.getItem(HISTORY_SESSION_KEY);
  historyEmpty.classList.toggle("hidden", sessions.length !== 0);
  const generated = exportsBySession(receipts);

  for (const session of sessions) {
    const entry = document.createElement("div");
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
    entry.appendChild(button);
    const files = generated.get(session.sessionId) || [];
    if (files.length) entry.appendChild(renderGeneratedFiles(files));
    historyList.appendChild(entry);
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
    const [sessionResponse, exportResponse] = await Promise.all([
      fetch("/api/chat/sessions?limit=100", { headers: { accept: "application/json" } }),
      fetch("/api/chat/exports?limit=500", { headers: { accept: "application/json" } }).catch(() => null)
    ]);
    if (!sessionResponse.ok) throw new Error(`CHAT_HISTORY_HTTP_${sessionResponse.status}`);
    const payload = await sessionResponse.json();
    let receipts = [];
    if (exportResponse?.ok) {
      const exportsPayload = await exportResponse.json().catch(() => ({}));
      receipts = Array.isArray(exportsPayload.exports) ? exportsPayload.exports : [];
    }
    renderHistory(Array.isArray(payload.sessions) ? payload.sessions : [], receipts);
  } catch {
    historyList.textContent = "";
    const failed = document.createElement("div");
    failed.className = "history-empty";
    failed.textContent = "Chat history could not be loaded.";
    historyList.appendChild(failed);
  }
}

function currentEligibleResponses() {
  if (typeof state === "undefined" || !state.messages) return [];
  return [...state.messages.values()].filter((message) =>
    message.role === "assistant" &&
    (message.state === "complete" || message.state === "stopped") &&
    String(message.content || "").trim()
  );
}

function currentAttachments() {
  if (typeof state === "undefined" || !state.messages) return [];
  const result = [];
  const seen = new Set();
  for (const message of state.messages.values()) {
    for (const attachment of message.attachments || []) {
      if (!attachment?.id || seen.has(attachment.id)) continue;
      seen.add(attachment.id);
      result.push({ message, attachment });
    }
  }
  return result;
}

function resetSelectionForSession() {
  const sessionId = typeof state !== "undefined" ? state.sessionId : null;
  if (selectionSessionId === sessionId) return;
  selectionSessionId = sessionId;
  selectedResponseIds.clear();
  selectedAttachmentIds.clear();
}

function selectorCheckbox({ checked, label, meta, onChange }) {
  const row = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = label;
  const small = document.createElement("span");
  small.textContent = meta;
  copy.append(strong, document.createTextNode(" · "), small);
  row.append(input, copy);
  input.addEventListener("change", () => onChange(input.checked));
  return row;
}

function ensureSelectorDialog() {
  if (selectorDialog) return selectorDialog;
  const dialog = document.createElement("dialog");
  dialog.className = "github-chat-consent-dialog";
  dialog.id = "contextSelectorDialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("header");
  const heading = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "chat-kicker";
  kicker.textContent = "CONTEXT SELECTOR";
  const title = document.createElement("strong");
  title.id = "contextSelectorTitle";
  title.textContent = "CREATE DOCUMENT";
  heading.append(kicker, title);
  const close = document.createElement("button");
  close.value = "cancel";
  close.setAttribute("aria-label", "Close selector");
  close.textContent = "×";
  header.append(heading, close);

  const responsesTitle = document.createElement("p");
  responsesTitle.innerHTML = "<strong>AI RESPONSES</strong>";
  const responses = document.createElement("div");
  responses.className = "github-chat-consent-points";
  responses.id = "contextSelectorResponses";
  const attachmentsTitle = document.createElement("p");
  attachmentsTitle.innerHTML = "<strong>ATTACHMENTS FROM HISTORY</strong>";
  const attachments = document.createElement("div");
  attachments.className = "github-chat-consent-points";
  attachments.id = "contextSelectorAttachments";
  const outputTitle = document.createElement("p");
  outputTitle.id = "contextSelectorOutputTitle";
  outputTitle.innerHTML = "<strong>OUTPUT</strong>";
  const outputs = document.createElement("div");
  outputs.className = "github-chat-consent-points";
  outputs.id = "contextSelectorOutputs";
  for (const [value, label] of [["pdf", "PDF"], ["docx", "DOCX"], ["pdf+docx", "PDF + DOCX"], ["zip", "ZIP bundle"]]) {
    const option = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "contextSelectorOutput";
    radio.value = value;
    radio.checked = value === "pdf";
    option.append(radio, document.createTextNode(` ${label}`));
    outputs.appendChild(option);
  }

  const error = document.createElement("div");
  error.className = "attachment-error hidden";
  error.id = "contextSelectorError";
  error.setAttribute("role", "alert");
  const footer = document.createElement("footer");
  const cancel = document.createElement("button");
  cancel.value = "cancel";
  cancel.textContent = "Cancel";
  const create = document.createElement("button");
  create.type = "button";
  create.className = "github-chat-approve";
  create.id = "contextSelectorCreate";
  create.textContent = "CREATE";
  footer.append(cancel, create);

  form.append(header, responsesTitle, responses, attachmentsTitle, attachments, outputTitle, outputs, error, footer);
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  create.addEventListener("click", () => void executeSelector());
  selectorDialog = dialog;
  return dialog;
}

function selectionError(message = "") {
  const error = document.getElementById("contextSelectorError");
  if (!error) return;
  error.textContent = message;
  error.classList.toggle("hidden", !message);
}

function renderSelector() {
  resetSelectionForSession();
  const responsesNode = document.getElementById("contextSelectorResponses");
  const attachmentsNode = document.getElementById("contextSelectorAttachments");
  if (!responsesNode || !attachmentsNode) return;
  responsesNode.textContent = "";
  attachmentsNode.textContent = "";

  const responses = currentEligibleResponses();
  for (const message of responses) {
    const time = new Date(message.completedAt || message.createdAt);
    const when = Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const preview = String(message.content || "").replace(/\s+/g, " ").slice(0, 72);
    responsesNode.appendChild(selectorCheckbox({
      checked: selectedResponseIds.has(message.id),
      label: `${historyModelLabel(message.model || "AI")} · ${when}`,
      meta: preview,
      onChange: (checked) => {
        if (checked) selectedResponseIds.add(message.id); else selectedResponseIds.delete(message.id);
        scheduleResponseActionSync();
      }
    }));
  }
  if (!responses.length) {
    const empty = document.createElement("span");
    empty.textContent = "No completed AI responses yet.";
    responsesNode.appendChild(empty);
  }

  const attachments = currentAttachments();
  for (const { attachment } of attachments) {
    attachmentsNode.appendChild(selectorCheckbox({
      checked: selectedAttachmentIds.has(attachment.id),
      label: attachment.name || "attachment",
      meta: `${attachment.mimeType || "file"} · ${typeof formatBytes === "function" ? formatBytes(Number(attachment.size) || 0) : `${attachment.size || 0} B`}`,
      onChange: (checked) => {
        if (checked) selectedAttachmentIds.add(attachment.id); else selectedAttachmentIds.delete(attachment.id);
      }
    }));
  }
  if (!attachments.length) {
    const empty = document.createElement("span");
    empty.textContent = "No attachments in this session.";
    attachmentsNode.appendChild(empty);
  }
}

function openSelector({ singleResponseId = null } = {}) {
  resetSelectionForSession();
  selectorMode = "export";
  if (singleResponseId) {
    selectedResponseIds.clear();
    selectedAttachmentIds.clear();
    selectedResponseIds.add(singleResponseId);
  }
  const dialog = ensureSelectorDialog();
  document.getElementById("contextSelectorTitle").textContent = "CREATE DOCUMENT";
  document.getElementById("contextSelectorOutputTitle")?.classList.remove("hidden");
  document.getElementById("contextSelectorOutputs")?.classList.remove("hidden");
  document.getElementById("contextSelectorCreate").textContent = "CREATE";
  selectionError("");
  renderSelector();
  dialog.showModal();
}

async function executeSelector() {
  if (selectorMode !== "export") return;
  if (!selectedResponseIds.size && !selectedAttachmentIds.size) {
    selectionError("Select at least one AI response or attachment.");
    return;
  }
  if (!state?.sessionId) {
    selectionError("No active chat session.");
    return;
  }
  const create = document.getElementById("contextSelectorCreate");
  const checked = document.querySelector('input[name="contextSelectorOutput"]:checked');
  const output = checked?.value || "pdf";
  create.disabled = true;
  create.textContent = "CREATING…";
  selectionError("");
  try {
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(state.sessionId)}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        responseIds: [...selectedResponseIds],
        attachmentIds: [...selectedAttachmentIds],
        output
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `CHAT_EXPORT_HTTP_${response.status}`);
    selectorDialog?.close();
    renderExportReceipt(payload);
    if (historyPanel?.classList.contains("open")) void loadHistory();
  } catch (error) {
    selectionError(error instanceof Error ? error.message : "Export failed.");
  } finally {
    create.disabled = false;
    create.textContent = "CREATE";
  }
}

async function exportAction(receipt, file, action, button) {
  const previous = button.textContent;
  button.disabled = true;
  try {
    const response = await fetch("/api/chat/exports/actions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sessionId: receipt.sessionId, exportId: receipt.exportId, fileId: file.fileId, action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `CHAT_EXPORT_ACTION_HTTP_${response.status}`);
    button.textContent = action === "reveal" ? "Revealed" : "Opened";
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : "Failed";
  } finally {
    window.setTimeout(() => {
      button.textContent = previous;
      button.disabled = false;
    }, 1400);
  }
}

function renderExportReceipt(receipt) {
  let panel = document.getElementById("exportReceipt");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "exportReceipt";
    panel.className = "stage-zero-notice";
    const anchor = document.getElementById("stageZeroNotice");
    anchor?.parentNode?.insertBefore(panel, anchor.nextSibling);
  }
  panel.textContent = "";
  const title = document.createElement("strong");
  title.textContent = "EXPORT COMPLETE";
  panel.appendChild(title);
  for (const file of receipt.files || []) {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = `${file.kind} · ${file.name}`;
    const path = document.createElement("code");
    path.textContent = file.path;
    row.append(label, document.createTextNode(" "), path);
    panel.appendChild(row);
  }
  const primary = (receipt.files || []).find((file) => file.kind === "ZIP") || receipt.files?.[0];
  if (primary) {
    const actions = document.createElement("div");
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "secondary-button";
    reveal.textContent = "Reveal in Finder";
    reveal.addEventListener("click", () => void exportAction(receipt, primary, "reveal", reveal));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "secondary-button";
    copy.textContent = "Copy path";
    copy.addEventListener("click", () => typeof copyText === "function" ? void copyText(primary.path, copy) : undefined);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "secondary-button";
    open.textContent = "Open";
    open.addEventListener("click", () => void exportAction(receipt, primary, "open", open));
    actions.append(reveal, copy, open);
    panel.appendChild(actions);
  }
}

function addResponseActions(article, message) {
  if (!article || !message || message.role !== "assistant") return;
  const meta = article.querySelector(".message-meta");
  if (!meta) return;
  let select = meta.querySelector(".message-select-export");
  if (!select) {
    select = document.createElement("button");
    select.type = "button";
    select.className = "message-copy message-select-export";
    select.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetSelectionForSession();
      if (selectedResponseIds.has(message.id)) selectedResponseIds.delete(message.id); else selectedResponseIds.add(message.id);
      scheduleResponseActionSync();
    });
    meta.appendChild(select);
  }
  select.disabled = !(message.state === "complete" || message.state === "stopped");
  select.textContent = selectedResponseIds.has(message.id) ? "Selected" : "Select";
  select.title = selectedResponseIds.has(message.id) ? "Remove this response from document selection" : "Select this response for document creation";

  let exportButton = meta.querySelector(".message-export-one");
  if (!exportButton) {
    exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "message-copy message-export-one";
    exportButton.textContent = "Export";
    exportButton.title = "Export this AI response";
    exportButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSelector({ singleResponseId: message.id });
    });
    meta.appendChild(exportButton);
  }
  exportButton.disabled = !(message.state === "complete" || message.state === "stopped");
}

function syncResponseActions() {
  responseSyncScheduled = false;
  resetSelectionForSession();
  if (typeof state === "undefined" || !state.messages) return;
  for (const message of state.messages.values()) {
    if (message.role !== "assistant") continue;
    const article = document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
    if (article) addResponseActions(article, message);
  }
  const create = document.getElementById("createDocumentButton");
  if (create) create.disabled = !state.sessionId || (!currentEligibleResponses().length && !currentAttachments().length);
}

function scheduleResponseActionSync() {
  if (responseSyncScheduled) return;
  responseSyncScheduled = true;
  queueMicrotask(syncResponseActions);
}

function installDocumentExport() {
  const oldButtons = [document.getElementById("exportMdButton"), document.getElementById("exportPdfButton"), document.getElementById("exportZipButton")];
  const group = document.querySelector(".v5-toolbar-left") || document.querySelector(".chat-action-group");
  if (group && !document.getElementById("createDocumentButton")) {
    const button = document.createElement("button");
    button.id = "createDocumentButton";
    button.type = "button";
    button.className = group.classList.contains("v5-toolbar-left") ? "v5-action" : "secondary-button chat-action-button";
    button.textContent = "Create document";
    button.title = "Select AI responses and attachments, then create PDF, DOCX or ZIP";
    button.addEventListener("click", () => openSelector());
    const stageZero = document.getElementById("stageZeroButton");
    if (stageZero?.parentNode === group) group.insertBefore(button, stageZero);
    else group.appendChild(button);
  }
  const thread = document.getElementById("chatThread");
  if (thread) new MutationObserver(scheduleResponseActionSync).observe(thread, { childList: true, subtree: true });
  scheduleResponseActionSync();
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

installDocumentExport();
