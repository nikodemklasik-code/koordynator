const usage24h = document.getElementById("usage24h");

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number < 1000) return String(number);
  if (number < 1_000_000) return `${(number / 1000).toFixed(number >= 100_000 ? 0 : 1)}k`;
  return `${(number / 1_000_000).toFixed(number >= 100_000_000 ? 0 : 1)}m`;
}

function providerReceiptUsage(receipts) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let harnessTokens = 0;
  let paidTokens = 0;
  let harnessRequests = 0;
  let paidRequests = 0;
  let unreported = 0;
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    const time = Date.parse(receipt.completedAt || receipt.startedAt || "");
    if (!Number.isFinite(time) || time < cutoff || receipt.result !== "SUCCESS") continue;
    const billing = String(receipt.billingPath || "UNKNOWN").toUpperCase();
    const total = Number(receipt.usage?.totalTokens);
    const tokens = Number.isFinite(total) ? total : Number(receipt.usage?.inputTokens || 0) + Number(receipt.usage?.outputTokens || 0);
    const reported = receipt.usage && Number.isFinite(tokens);
    if (billing === "SUBSCRIPTION_INCLUDED" || billing === "SUBSCRIPTION_CREDITS") {
      harnessRequests += 1;
      if (reported) harnessTokens += tokens;
      else unreported += 1;
    } else if (billing === "API_PAYG") {
      paidRequests += 1;
      if (reported) paidTokens += tokens;
      else unreported += 1;
    }
  }
  return { harnessTokens, paidTokens, harnessRequests, paidRequests, unreported };
}

function bucket(chat, source) {
  return chat.bySource?.[source] || {};
}

async function loadUsage24h() {
  if (!usage24h) return;
  try {
    const [chatResponse, providerResponse] = await Promise.all([
      fetch("/api/chat/usage?hours=24", { headers: { accept: "application/json" } }),
      fetch("/api/provider-receipts?limit=200", { headers: { accept: "application/json" } })
    ]);
    if (!chatResponse.ok || !providerResponse.ok) throw new Error("USAGE_HTTP_ERROR");
    const chat = await chatResponse.json();
    const providerPayload = await providerResponse.json();
    const provider = providerReceiptUsage(providerPayload.receipts);

    const confirmedFree = bucket(chat, "FREE_CONFIRMED");
    const freeOauth = bucket(chat, "FREE_OAUTH");
    const liveHarness = bucket(chat, "SUBSCRIPTION_HARNESS");
    const requested = bucket(chat, "FREE_REQUESTED");
    const chatPaid = bucket(chat, "PAID_API");
    const unknown = bucket(chat, "UNKNOWN");

    const freeTokens = Number(confirmedFree.totalTokens || 0) + Number(freeOauth.totalTokens || 0);
    const harnessTokens = Number(liveHarness.totalTokens || 0) + provider.harnessTokens;
    const paidTokens = Number(chatPaid.totalTokens || 0) + provider.paidTokens;
    const unknownRequests = Number(unknown.requests || 0) + Number(requested.requests || 0);
    const unreported = Number(chat.tokenTelemetryUnreported || 0) + provider.unreported;

    usage24h.textContent = `24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`;
    usage24h.className = `usage-24h ${paidTokens > 0 || unknownRequests > 0 ? "attention" : "clean"}`;
    usage24h.title = [
      `Confirmed free API: ${confirmedFree.requests || 0} requests / ${confirmedFree.totalTokens || 0} reported tokens`,
      `Free OAuth: ${freeOauth.requests || 0} requests / ${freeOauth.totalTokens || 0} reported tokens`,
      `Live Chat subscription harness: ${liveHarness.requests || 0} requests / ${liveHarness.totalTokens || 0} reported tokens`,
      `Other provider subscription receipts: ${provider.harnessRequests} requests / ${provider.harnessTokens} reported tokens`,
      `PAYG API: ${Number(chatPaid.requests || 0) + provider.paidRequests} requests / ${paidTokens} reported tokens`,
      `Unconfirmed or unknown billing: ${unknownRequests} requests`,
      `Requests without provider token telemetry: ${unreported}`,
      "Token totals include only provider-reported usage. No estimates are presented as facts."
    ].join("\n");
  } catch {
    usage24h.textContent = "24H USAGE · TELEMETRY UNAVAILABLE";
    usage24h.className = "usage-24h attention";
    usage24h.title = "Usage provenance could not be loaded. Treat token source as unverified until telemetry recovers.";
  }
}

void loadUsage24h();
setInterval(() => void loadUsage24h(), 10_000);
window.addEventListener("focus", () => void loadUsage24h());

/*
 * Readable Hermes mirror.
 * Raw xterm remains the execution surface. This layer only mirrors visible PTY
 * output into selectable semantic question/answer blocks and never changes the
 * bytes sent to Hermes.
 */
(() => {
  const term = document.getElementById("hermesTerm");
  const pane = document.getElementById("hermesPane");
  const input = document.getElementById("hermesInput");
  const send = document.getElementById("sendHermesButton");
  const stateBadge = document.getElementById("hermesState");
  if (!term || !pane || !input || !send || document.getElementById("hermesTranscript")) return;

  const stack = document.createElement("div");
  stack.className = "terminal-output-stack";
  const bar = document.createElement("div");
  bar.className = "terminal-viewbar";
  bar.innerHTML = '<span class="terminal-viewbar-label">Hermes context</span><button class="terminal-view-button active" id="hermesReadableButton" type="button">Readable</button><button class="terminal-view-button" id="hermesRawButton" type="button">Raw PTY</button><button class="terminal-view-button copy" id="hermesCopyButton" type="button">Copy</button>';
  const transcript = document.createElement("div");
  transcript.className = "terminal-readable";
  transcript.id = "hermesTranscript";
  transcript.setAttribute("tabindex", "0");
  transcript.setAttribute("aria-label", "Readable Hermes transcript. Text is selectable and copyable.");
  const systemLog = document.createElement("div");
  systemLog.className = "terminal-system-log";
  transcript.appendChild(systemLog);

  term.parentNode.insertBefore(stack, term);
  stack.append(bar, transcript, term);

  const readableButton = bar.querySelector("#hermesReadableButton");
  const rawButton = bar.querySelector("#hermesRawButton");
  const copyButton = bar.querySelector("#hermesCopyButton");

  let currentAnswer = null;
  let lastQuestion = "";
  let buffer = "";
  let partialTimer = null;

  function stripAnsi(value) {
    return String(value || "")
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
      .replace(/\x1b[@-_]/g, "")
      .replace(/\u0000/g, "");
  }

  function normalized(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isNoise(line) {
    const text = line.trim();
    if (!text) return true;
    if (/^(?:info|debug|trace|warn(?:ing)?|notice|system|tool|provider|model|session|context|tokens?|cost|usage|loaded|loading|connected|starting|using|route|fallback|config|hermes agent)\b[:\s-]*/i.test(text)) return true;
    if (/^[✓✔⚠●◆◇▶▷·•#>]+\s*/.test(text)) return true;
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+.*[%$#]\s*$/.test(text)) return true;
    if (/^(?:\[.*?\]\s*)?(?:tool|status|event|thinking|reasoning)[:>]/i.test(text)) return true;
    if (/^[-_=]{3,}$/.test(text)) return true;
    return false;
  }

  function ensureAnswer() {
    if (currentAnswer) return currentAnswer;
    const exchange = document.createElement("section");
    exchange.className = "terminal-exchange terminal-system-exchange";
    currentAnswer = document.createElement("div");
    currentAnswer.className = "terminal-answer";
    exchange.appendChild(currentAnswer);
    transcript.appendChild(exchange);
    return currentAnswer;
  }

  function startExchange(question) {
    const text = String(question || "").trim();
    if (!text) return;
    lastQuestion = text;
    const exchange = document.createElement("section");
    exchange.className = "terminal-exchange";
    const q = document.createElement("div");
    q.className = "terminal-question";
    q.textContent = text;
    currentAnswer = document.createElement("div");
    currentAnswer.className = "terminal-answer";
    exchange.append(q, currentAnswer);
    transcript.appendChild(exchange);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function appendLine(line) {
    const clean = line.replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trimEnd();
    if (!clean.trim()) return;
    const compact = normalized(clean);
    const question = normalized(lastQuestion);
    if (question && (compact === question || compact.endsWith(` ${question}`))) return;

    const target = currentAnswer || systemLog;
    const row = document.createElement("div");
    const noise = isNoise(clean);
    row.className = noise ? `terminal-noise${/warn|error|fail|denied/i.test(clean) ? " warning" : ""}` : "terminal-answer-line";
    row.textContent = clean;
    target.appendChild(row);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function flushPartial() {
    partialTimer = null;
    if (!buffer.trim()) return;
    appendLine(buffer);
    buffer = "";
  }

  function mirrorOutput(value) {
    const clean = stripAnsi(value).replace(/\r(?!\n)/g, "\n");
    if (!clean) return;
    buffer += clean;
    const parts = buffer.split(/\n/);
    buffer = parts.pop() || "";
    for (const line of parts) appendLine(line);
    if (partialTimer) clearTimeout(partialTimer);
    partialTimer = setTimeout(flushPartial, 180);
  }

  const originalAppend = window.appendHermesOutput;
  if (typeof originalAppend === "function") {
    window.appendHermesOutput = function readableHermesOutput(text) {
      mirrorOutput(text);
      return originalAppend(text);
    };
  }

  function captureQuestion() {
    const text = input.value.trim();
    if (!text || String(stateBadge?.textContent || "").toUpperCase() !== "LIVE") return;
    startExchange(text);
  }

  send.addEventListener("click", captureQuestion, true);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) captureQuestion();
  }, true);

  function setRaw(raw) {
    stack.classList.toggle("terminal-raw-mode", raw);
    readableButton.classList.toggle("active", !raw);
    rawButton.classList.toggle("active", raw);
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  readableButton.addEventListener("click", () => setRaw(false));
  rawButton.addEventListener("click", () => setRaw(true));

  async function copyTranscript() {
    const selection = window.getSelection();
    const selected = selection && selection.anchorNode && transcript.contains(selection.anchorNode)
      ? selection.toString().trim()
      : "";
    const text = selected || transcript.innerText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Copied";
      copyButton.classList.add("terminal-copy-flash");
      setTimeout(() => {
        copyButton.textContent = "Copy";
        copyButton.classList.remove("terminal-copy-flash");
      }, 1000);
    } catch {
      copyButton.textContent = "Select + ⌘C";
      setTimeout(() => { copyButton.textContent = "Copy"; }, 1400);
    }
  }
  copyButton.addEventListener("click", () => void copyTranscript());

  // Existing boot noise stays small and gray until the first real question.
  ensureAnswer();
  currentAnswer = null;
})();
