const $ = (id) => document.getElementById(id);
let fabric = null;
let githubConnection = null;
let githubConnecting = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortDigest(value, left = 16, right = 8) {
  const text = String(value ?? "—");
  return text.length <= left + right + 1 ? text : `${text.slice(0, left)}…${text.slice(-right)}`;
}

function healthClass(health) {
  return String(health).toLowerCase();
}

function usageSourceForBilling(value) {
  const billing = String(value ?? "UNKNOWN").toUpperCase();
  if (billing === "SUBSCRIPTION_INCLUDED" || billing === "SUBSCRIPTION_CREDITS") return "SUBSCRIPTION-HARNESS";
  if (billing === "API_PAYG") return "PAID-API";
  if (billing === "LOCAL") return "LOCAL";
  if (billing === "ENTERPRISE_CREDITS") return "ENTERPRISE-CREDITS";
  return "UNKNOWN";
}

function reportedTokenCount(receipt) {
  const usage = receipt?.usage;
  if (!usage || usage.reportedBy !== "PROVIDER") return null;
  const explicit = Number(usage.totalTokens);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.trunc(explicit);
  const input = Number(usage.inputTokens);
  const output = Number(usage.outputTokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  return Math.trunc((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0));
}

function providerRow(provider) {
  const d = provider.descriptor;
  const source = usageSourceForBilling(d.billingMode);
  return `<article class="provider-row" data-provider-id="${escapeHtml(provider.providerId)}">
    <div class="provider-name" data-label="PROVIDER"><strong>${escapeHtml(provider.providerId)}</strong><small>${escapeHtml(d.capabilities.join(", "))}</small></div>
    <div class="provider-exe" data-label="EXECUTABLE"><code>${escapeHtml(provider.executable)}</code></div>
    <div data-label="HEALTH"><span class="health-badge ${healthClass(provider.health)}">● ${escapeHtml(provider.health)}</span></div>
    <div class="provider-access" data-label="SOURCE"><code>${escapeHtml(source)}</code><br><small>${escapeHtml(d.accessMode)} / ${escapeHtml(d.billingMode ?? "UNKNOWN")}</small></div>
    <div class="provider-actions" data-label="ACTIONS"><button data-action="doctor" type="button">Doctor</button><button data-action="connect" type="button">Connect</button></div>
  </article>`;
}

function receiptRow(receipt) {
  const source = usageSourceForBilling(receipt.billingPath);
  const tokens = reportedTokenCount(receipt);
  const tokenText = tokens === null ? "TOKEN COUNT UNREPORTED" : `${tokens.toLocaleString()} TOKENS · PROVIDER REPORTED`;
  const cost = typeof receipt.usage?.cost === "number"
    ? ` · COST ${receipt.usage.cost}${receipt.usage.currency ? ` ${String(receipt.usage.currency).toUpperCase()}` : ""}`
    : "";
  return `<article class="receipt-row">
    <div data-label="PROVIDER"><strong>${escapeHtml(receipt.providerId)}</strong><br><code>${escapeHtml(receipt.capability)}</code></div>
    <div data-label="TASK">${escapeHtml(receipt.taskId)}</div>
    <div data-label="RESULT"><span class="result-${String(receipt.result).toLowerCase()}">${escapeHtml(receipt.result)}</span></div>
    <div data-label="ACCESS">${escapeHtml(receipt.accessMode)}</div>
    <div data-label="SOURCE"><strong>${escapeHtml(source)}</strong><br><code>${escapeHtml(receipt.billingPath ?? "UNKNOWN")}</code><br><small>${escapeHtml(tokenText + cost)}</small></div>
    <div data-label="RECEIPT"><code title="${escapeHtml(receipt.receiptFp)}">${escapeHtml(shortDigest(receipt.receiptFp))}</code></div>
  </article>`;
}

function render(data) {
  fabric = data;
  $("providerRows").innerHTML = data.providers.map(providerRow).join("");
  $("receiptRows").innerHTML = data.receipts.length ? data.receipts.map(receiptRow).join("") : '<div class="empty-receipts">No persisted provider receipts.</div>';
  const unhealthy = data.providers.filter((provider) => provider.health !== "HEALTHY");
  $("healthSummary").textContent = unhealthy.length === 0 ? "All configured official CLIs healthy" : `${unhealthy.length} provider${unhealthy.length === 1 ? "" : "s"} require attention`;
}

async function loadProviders(force = false) {
  $("providerRows").innerHTML = '<div class="loading-line">Checking providers…</div>';
  const response = await fetch(`/api/providers${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`PROVIDERS_HTTP_${response.status}`);
  render(await response.json());
}

function openCommand(title, description, command) {
  $("commandTitle").textContent = title;
  $("commandDescription").textContent = description;
  $("commandText").textContent = command;
  $("commandDialog").showModal();
}

async function runDoctor(providerId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}/doctor`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DOCTOR_HTTP_${response.status}`);
    const result = await response.json();
    const card = button.closest(".provider-row");
    const badge = card.querySelector(".health-badge");
    badge.textContent = `● ${result.health}`;
    badge.className = `health-badge ${healthClass(result.health)}`;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function githubStateCopy(status) {
  if (!status) return { badge: "CHECKING", detail: "Checking local GitHub repository access.", action: "Connect GitHub", disabled: true };
  if (status.state === "CONNECTED" && status.connectionMethod === "GIT_CREDENTIAL") {
    return {
      badge: "CONNECTED · GIT",
      detail: `Repository access is already working through the local Git credential path${status.remote ? ` (${status.remote})` : ""}. GitHub CLI is not required for read-only repository access.`,
      action: "Connected",
      disabled: true
    };
  }
  if (status.state === "CONNECTED") {
    return {
      badge: "CONNECTED · GH",
      detail: "GitHub CLI is authenticated for github.com. Existing authentication will be reused for repository operations.",
      action: "Connected",
      disabled: true
    };
  }
  if (status.state === "AUTH_REQUIRED") {
    return {
      badge: "AUTH REQUIRED",
      detail: "GitHub CLI is available but not authenticated. Connection starts only after your explicit approval.",
      action: "Connect GitHub",
      disabled: false
    };
  }
  if (status.state === "UNAVAILABLE") {
    return {
      badge: "UNAVAILABLE",
      detail: "Neither a working Git credential path nor GitHub CLI authentication is available to Koordynator.",
      action: "Show setup",
      disabled: false
    };
  }
  return {
    badge: "DEGRADED",
    detail: "GitHub could not report a reliable repository access state. Refresh the check or reconnect.",
    action: "Reconnect",
    disabled: false
  };
}

function renderGitHubConnection(status) {
  githubConnection = status;
  const copy = githubStateCopy(status);
  const badge = $("githubStateBadge");
  badge.textContent = copy.badge;
  badge.className = `github-state ${String(status?.state ?? "checking").toLowerCase()}`;
  $("githubConnectionDetail").textContent = copy.detail;
  const button = $("githubConnectButton");
  button.textContent = githubConnecting ? "Connecting…" : copy.action;
  button.disabled = githubConnecting || copy.disabled;
  $("githubRefreshButton").disabled = githubConnecting;
}

async function loadGitHubConnection(force = false) {
  if (!githubConnecting) renderGitHubConnection(null);
  const response = await fetch(`/api/integrations/github${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GITHUB_STATUS_HTTP_${response.status}`);
  const status = await response.json();
  renderGitHubConnection(status);
  return status;
}

function requestGitHubConsent() {
  if (githubConnecting) return;
  if (githubConnection?.state === "CONNECTED") return;
  if (githubConnection?.state === "UNAVAILABLE") {
    openCommand("GitHub setup", "Install the official GitHub CLI if the existing Git credential path cannot access the required repository.", "brew install gh && gh auth login --hostname github.com --git-protocol https --web");
    return;
  }
  $("githubConsentDialog").showModal();
}

async function connectGitHub() {
  if (githubConnecting) return;
  githubConnecting = true;
  renderGitHubConnection(githubConnection);
  const approve = $("githubConsentApprove");
  const before = approve.textContent;
  approve.disabled = true;
  approve.textContent = "Waiting for GitHub…";
  try {
    const response = await fetch("/api/integrations/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ approved: true })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `GITHUB_CONNECT_HTTP_${response.status}`);
    $("githubConsentDialog").close();
    renderGitHubConnection(payload);
  } catch (error) {
    $("githubConsentDialog").close();
    openCommand(
      "GitHub connection failed",
      error instanceof Error ? error.message : "GitHub connection failed",
      "gh auth status --hostname github.com"
    );
    await loadGitHubConnection(true).catch(() => undefined);
  } finally {
    githubConnecting = false;
    approve.disabled = false;
    approve.textContent = before;
    renderGitHubConnection(githubConnection);
  }
}

$("providerRows").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("[data-provider-id]");
  const providerId = row?.dataset.providerId;
  if (!providerId || !fabric) return;
  const provider = fabric.providers.find((item) => item.providerId === providerId);
  if (!provider) return;
  if (button.dataset.action === "doctor") {
    runDoctor(providerId, button).catch((error) => openCommand("Doctor failed", error.message, provider.doctorCommand));
    return;
  }
  openCommand(
    `Connect ${providerId}`,
    "Authentication is intentionally delegated to the provider's official CLI. The Control UI does not collect provider passwords, tokens, or browser cookies.",
    provider.connectCommand
  );
});

$("refreshProviders").addEventListener("click", () => loadProviders(true).catch((error) => openCommand("Provider refresh failed", error.message, "orchestrator provider doctor")));
$("githubRefreshButton").addEventListener("click", () => loadGitHubConnection(true).catch((error) => openCommand("GitHub refresh failed", error.message, "git ls-remote origin HEAD")));
$("githubConnectButton").addEventListener("click", requestGitHubConsent);
$("githubConsentApprove").addEventListener("click", () => void connectGitHub());
$("copyCommand").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("commandText").textContent);
  const before = $("copyCommand").textContent;
  $("copyCommand").textContent = "Copied";
  setTimeout(() => { $("copyCommand").textContent = before; }, 900);
});

Promise.all([
  fetch("/api/health", { headers: { accept: "application/json" } }).then((response) => response.ok ? response.json() : Promise.reject(new Error(`HEALTH_HTTP_${response.status}`))),
  loadProviders(),
  loadGitHubConnection()
]).then(([health]) => {
  $("versionLabel").textContent = `v${health.version}`;
}).catch((error) => {
  $("providerRows").innerHTML = `<div class="empty-receipts">${escapeHtml(error.message)}</div>`;
});
