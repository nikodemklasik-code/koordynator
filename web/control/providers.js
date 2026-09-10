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

function providerRow(provider) {
  const d = provider.descriptor;
  return `<article class="provider-row" data-provider-id="${escapeHtml(provider.providerId)}">
    <div class="provider-name"><strong>${escapeHtml(provider.providerId)}</strong><small>${escapeHtml(d.capabilities.join(", "))}</small></div>
    <div class="provider-exe"><code>${escapeHtml(provider.executable)}</code></div>
    <div><span class="health-badge ${healthClass(provider.health)}">● ${escapeHtml(provider.health)}</span></div>
    <div class="provider-access"><code>${escapeHtml(d.accessMode)} / ${escapeHtml(d.billingMode ?? "UNKNOWN")}</code></div>
    <div class="provider-actions"><button data-action="doctor" type="button">Doctor</button><button data-action="connect" type="button">Connect</button></div>
  </article>`;
}

function receiptRow(receipt) {
  return `<article class="receipt-row">
    <div><strong>${escapeHtml(receipt.providerId)}</strong><br><code>${escapeHtml(receipt.capability)}</code></div>
    <div>${escapeHtml(receipt.taskId)}</div>
    <div><span class="result-${String(receipt.result).toLowerCase()}">${escapeHtml(receipt.result)}</span></div>
    <div>${escapeHtml(receipt.accessMode)}</div>
    <div>${escapeHtml(receipt.billingPath ?? "UNKNOWN")}</div>
    <div><code title="${escapeHtml(receipt.receiptFp)}">${escapeHtml(shortDigest(receipt.receiptFp))}</code></div>
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
  if (!status) return { badge: "CHECKING", detail: "Checking the local GitHub CLI connection.", action: "Connect GitHub", disabled: true };
  if (status.state === "CONNECTED") {
    return {
      badge: "CONNECTED",
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
      detail: "GitHub CLI (gh) is not available on this machine. Install it before repository connection can be started.",
      action: "GitHub CLI unavailable",
      disabled: true
    };
  }
  return {
    badge: "DEGRADED",
    detail: "GitHub CLI could not report a reliable authentication state. Refresh the check or reconnect.",
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
    openCommand("GitHub CLI unavailable", "Repository connection requires the official GitHub CLI on this machine.", "gh --version");
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
$("githubRefreshButton").addEventListener("click", () => loadGitHubConnection(true).catch((error) => openCommand("GitHub refresh failed", error.message, "gh auth status --hostname github.com")));
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
