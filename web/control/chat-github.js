const githubChatButton = document.getElementById("githubChatButton");
const githubChatDot = document.getElementById("githubChatDot");
const githubChatLabel = document.getElementById("githubChatLabel");
const githubChatNotice = document.getElementById("githubChatNotice");
const githubChatConsentDialog = document.getElementById("githubChatConsentDialog");
const githubChatConsentApprove = document.getElementById("githubChatConsentApprove");
const githubChatConsentCancel = document.getElementById("githubChatConsentCancel");
const githubMessageInput = document.getElementById("messageInput");
const githubSendButton = document.getElementById("sendButton");

const githubChatState = {
  status: null,
  loading: null,
  connecting: false,
  pendingSend: false,
  bypassOnce: false
};

function isRepositoryIntent(text) {
  const value = String(text || "");
  return /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(value)
    || /(?:^|[^A-Za-z0-9_])github(?:$|[^A-Za-z0-9_])/i.test(value)
    || /(?:^|[^A-Za-z0-9_])repo(?:zytori(?:um|a|ów|u|ach|ami)?|sitory|sitories)?(?:$|[^A-Za-z0-9_])/i.test(value);
}

function githubNotice(message = "", kind = "") {
  if (!githubChatNotice) return;
  githubChatNotice.textContent = message;
  githubChatNotice.className = `github-chat-notice${kind ? ` ${kind}` : ""}${message ? "" : " hidden"}`;
}

function renderGitHubChatStatus(status) {
  githubChatState.status = status;
  if (!githubChatButton || !githubChatDot || !githubChatLabel) return;
  const state = status?.state || "CHECKING";
  githubChatButton.dataset.state = state;
  githubChatDot.className = `github-chat-dot ${state.toLowerCase()}`;
  githubChatButton.disabled = githubChatState.connecting;

  if (githubChatState.connecting) {
    githubChatLabel.textContent = "GitHub connecting…";
    return;
  }
  if (state === "CONNECTED" && status?.connectionMethod === "GIT_CREDENTIAL") githubChatLabel.textContent = "GitHub connected · git";
  else if (state === "CONNECTED") githubChatLabel.textContent = "GitHub connected · gh";
  else if (state === "AUTH_REQUIRED") githubChatLabel.textContent = "GitHub connect";
  else if (state === "UNAVAILABLE") githubChatLabel.textContent = "GitHub setup required";
  else if (state === "DEGRADED") githubChatLabel.textContent = "GitHub reconnect";
  else githubChatLabel.textContent = "GitHub checking…";
}

async function loadGitHubChatStatus(force = false) {
  if (githubChatState.loading && !force) return githubChatState.loading;
  const request = fetch(`/api/integrations/github${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`GITHUB_STATUS_HTTP_${response.status}`);
      const status = await response.json();
      renderGitHubChatStatus(status);
      return status;
    })
    .catch((error) => {
      renderGitHubChatStatus({ state: "DEGRADED" });
      githubNotice(error instanceof Error ? error.message : "GitHub status unavailable", "error");
      return githubChatState.status;
    })
    .finally(() => {
      if (githubChatState.loading === request) githubChatState.loading = null;
    });
  githubChatState.loading = request;
  return request;
}

function openGitHubConsent() {
  if (!githubChatConsentDialog || githubChatConsentDialog.open || githubChatState.connecting) return;
  githubChatConsentDialog.showModal();
}

function triggerPendingSend() {
  if (!githubChatState.pendingSend || !githubSendButton) return;
  githubChatState.pendingSend = false;
  githubChatState.bypassOnce = true;
  githubSendButton.click();
}

async function resolveRepositoryIntent() {
  const status = await loadGitHubChatStatus(true);
  if (status?.state === "CONNECTED") {
    githubNotice(status.connectionMethod === "GIT_CREDENTIAL" ? "Repository access verified through local Git credentials." : "Repository access verified through GitHub CLI.", "success");
    triggerPendingSend();
    return;
  }
  if (status?.state === "UNAVAILABLE") {
    githubChatState.pendingSend = false;
    githubNotice("GitHub setup is required. Existing Git credentials could not be verified and GitHub CLI is unavailable.", "error");
    return;
  }
  openGitHubConsent();
}

function interceptRepositorySend(event) {
  if (githubChatState.bypassOnce) {
    githubChatState.bypassOnce = false;
    return false;
  }
  const text = githubMessageInput?.value || "";
  if (!isRepositoryIntent(text)) return false;
  if (githubChatState.status?.state === "CONNECTED") return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  githubChatState.pendingSend = true;
  githubNotice("Repository request detected. Checking existing Git/GitHub permission…", "pending");
  void resolveRepositoryIntent();
  return true;
}

async function connectGitHubFromChat() {
  if (githubChatState.connecting) return;
  githubChatState.connecting = true;
  renderGitHubChatStatus(githubChatState.status);
  githubNotice("Waiting for GitHub browser authorization…", "pending");
  const original = githubChatConsentApprove?.textContent || "Approve & connect";
  if (githubChatConsentApprove) {
    githubChatConsentApprove.disabled = true;
    githubChatConsentApprove.textContent = "Waiting for GitHub…";
  }
  try {
    const response = await fetch("/api/integrations/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ approved: true })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `GITHUB_CONNECT_HTTP_${response.status}`);
    renderGitHubChatStatus(payload);
    githubNotice("GitHub connected. The pending repository request can continue.", "success");
    githubChatConsentDialog?.close();
    triggerPendingSend();
  } catch (error) {
    githubChatState.pendingSend = false;
    githubNotice(error instanceof Error ? error.message : "GitHub connection failed", "error");
    githubChatConsentDialog?.close();
    await loadGitHubChatStatus(true);
  } finally {
    githubChatState.connecting = false;
    if (githubChatConsentApprove) {
      githubChatConsentApprove.disabled = false;
      githubChatConsentApprove.textContent = original;
    }
    renderGitHubChatStatus(githubChatState.status);
  }
}

document.addEventListener("click", (event) => {
  if (event.target === githubSendButton || event.target?.closest?.("#sendButton")) interceptRepositorySend(event);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.target !== githubMessageInput || event.key !== "Enter" || event.shiftKey) return;
  interceptRepositorySend(event);
}, true);

githubChatButton?.addEventListener("click", async () => {
  const status = await loadGitHubChatStatus(true);
  if (status?.state === "CONNECTED") {
    githubNotice(status.connectionMethod === "GIT_CREDENTIAL" ? "GitHub repository access is active through local Git credentials." : "GitHub repository connection is active through GitHub CLI.", "success");
    return;
  }
  if (status?.state === "UNAVAILABLE") {
    githubNotice("Run: brew install gh && gh auth login --hostname github.com --git-protocol https --web", "error");
    return;
  }
  githubChatState.pendingSend = false;
  openGitHubConsent();
});

githubChatConsentApprove?.addEventListener("click", () => void connectGitHubFromChat());
githubChatConsentCancel?.addEventListener("click", () => {
  githubChatState.pendingSend = false;
  githubNotice("GitHub connection was not authorized. The repository request was not sent.", "pending");
});
githubChatConsentDialog?.addEventListener("cancel", () => {
  githubChatState.pendingSend = false;
  githubNotice("GitHub connection was not authorized. The repository request was not sent.", "pending");
});

void loadGitHubChatStatus();
