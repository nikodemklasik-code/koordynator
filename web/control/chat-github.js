const githubChatButton = document.getElementById("githubChatButton");
const githubChatDot = document.getElementById("githubChatDot");
const githubChatLabel = document.getElementById("githubChatLabel");
const githubChatNotice = document.getElementById("githubChatNotice");
const githubChatConsentDialog = document.getElementById("githubChatConsentDialog");
const githubChatConsentApprove = document.getElementById("githubChatConsentApprove");
const githubChatConsentCancel = document.getElementById("githubChatConsentCancel");
const githubMessageInput = document.getElementById("messageInput");
const githubSendButton = document.getElementById("sendButton");

const GITHUB_REPOSITORY_STORAGE_KEY = "koordynator.chat.github.repository";
const GITHUB_FALLBACK_REPOSITORY = "nikodemklasik-code/koordynator";

function storedRepository() {
  try {
    return localStorage.getItem(GITHUB_REPOSITORY_STORAGE_KEY)?.trim() || GITHUB_FALLBACK_REPOSITORY;
  } catch {
    return GITHUB_FALLBACK_REPOSITORY;
  }
}

const githubChatState = {
  status: null,
  loading: null,
  connecting: false,
  pendingSend: false,
  bypassOnce: false,
  repositories: [],
  repositoryLoading: null,
  selectedRepository: storedRepository()
};

const githubRepositoryMenu = document.createElement("div");
githubRepositoryMenu.id = "githubRepositoryMenu";
githubRepositoryMenu.className = "github-repository-menu hidden";
githubRepositoryMenu.setAttribute("role", "menu");
githubRepositoryMenu.setAttribute("aria-label", "GitHub repositories");
document.body.appendChild(githubRepositoryMenu);

function selectedRepositoryName() {
  return String(githubChatState.selectedRepository || "").split("/").pop() || "repository";
}

function closeRepositoryMenu() {
  githubRepositoryMenu.classList.add("hidden");
  githubChatButton?.setAttribute("aria-expanded", "false");
}

function positionRepositoryMenu() {
  if (!githubChatButton) return;
  const rect = githubChatButton.getBoundingClientRect();
  githubRepositoryMenu.style.top = `${Math.min(window.innerHeight - 80, rect.bottom + 6)}px`;
  githubRepositoryMenu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
}

function selectRepository(repository) {
  const value = String(repository || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return;
  githubChatState.selectedRepository = value;
  try { localStorage.setItem(GITHUB_REPOSITORY_STORAGE_KEY, value); } catch { /* private mode */ }
  renderGitHubChatStatus(githubChatState.status);
  renderRepositoryMenu();
  githubNotice(`Repository attached to chat: ${value}`, "success");
  window.dispatchEvent(new CustomEvent("koordynator:github-repository-changed", { detail: { repository: value } }));
}

window.koordynatorSelectedRepository = () => githubChatState.selectedRepository;
window.koordynatorSetSelectedRepository = (repository) => selectRepository(repository);

function isLocalWorkspaceIntent(text) {
  const value = String(text || "").toLowerCase();
  if (/https?:\/\/(?:www\.)?github\.com\//i.test(value) || /(?:^|[^A-Za-z0-9_])github(?:$|[^A-Za-z0-9_])/i.test(value)) {
    return false;
  }
  return /\b(lokaln\w*|local|workspace|katalog|folder)\b/i.test(value)
    || (/\b(wejd[zź]|otw[oó]rz|poka[zż]|wczytaj|przeczytaj|odczytaj)\b/i.test(value)
      && /\b(plik|file|src|docs|agents|kod|codebase)\b/i.test(value));
}

function isRepositoryIntent(text) {
  const value = String(text || "");
  if (isLocalWorkspaceIntent(value)) return false;
  return /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(value)
    || /(?:^|[^A-Za-z0-9_])github(?:$|[^A-Za-z0-9_])/i.test(value)
    || /(?:^|[^A-Za-z0-9_])repo(?:zytori(?:um|a|ów|u|ach|ami)?|sitory|sitories)?(?:$|[^A-Za-z0-9_])/i.test(value);
}

window.koordynatorRequestGithubConsent = function requestGithubConsent(message = "") {
  if (message) githubNotice(message, "pending");
  if (githubChatState.status?.state === "CONNECTED") return false;
  githubChatState.pendingSend = true;
  openGitHubConsent();
  return true;
};

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
  if (state === "CONNECTED" && status?.connectionMethod === "GIT_CREDENTIAL") githubChatLabel.textContent = `GitHub · ${selectedRepositoryName()} · git`;
  else if (state === "CONNECTED") githubChatLabel.textContent = `GitHub · ${selectedRepositoryName()} · gh`;
  else if (state === "AUTH_REQUIRED") githubChatLabel.textContent = "GitHub connect";
  else if (state === "UNAVAILABLE") githubChatLabel.textContent = "GitHub setup required";
  else if (state === "DEGRADED") githubChatLabel.textContent = "GitHub reconnect";
  else githubChatLabel.textContent = "GitHub checking…";
}

function renderRepositoryMenu() {
  const selected = githubChatState.selectedRepository;
  const rows = githubChatState.repositories;
  githubRepositoryMenu.replaceChildren();

  const header = document.createElement("div");
  header.className = "github-repository-menu-head";
  header.innerHTML = "<strong>GitHub repositories</strong><span>Choose repository for this chat</span>";
  githubRepositoryMenu.appendChild(header);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "github-repository-menu-empty";
    empty.textContent = githubChatState.repositoryLoading ? "Loading repositories…" : "No repositories returned.";
    githubRepositoryMenu.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `github-repository-item${row.repository === selected ? " active" : ""}`;
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", row.repository === selected ? "true" : "false");
    const branch = row.defaultBranch ? ` · ${row.defaultBranch}` : "";
    const visibility = row.private ? "private" : String(row.visibility || "").toLowerCase();
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = row.repository;
    button.querySelector("span").textContent = `${visibility}${branch}`;
    button.addEventListener("click", () => {
      selectRepository(row.repository);
      closeRepositoryMenu();
    });
    githubRepositoryMenu.appendChild(button);
  }
}

async function loadGitHubRepositories(force = false) {
  if (githubChatState.repositoryLoading && !force) return githubChatState.repositoryLoading;
  const request = fetch(`/api/integrations/github/repositories${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `GITHUB_REPOSITORIES_HTTP_${response.status}`);
      const repositories = Array.isArray(payload.repositories) ? payload.repositories : [];
      const fallback = typeof payload.defaultRepository === "string" && payload.defaultRepository.trim()
        ? payload.defaultRepository.trim()
        : GITHUB_FALLBACK_REPOSITORY;
      const selected = githubChatState.selectedRepository || fallback;
      const normalized = repositories
        .filter((row) => row && typeof row.repository === "string")
        .map((row) => ({
          repository: row.repository,
          url: row.url || `https://github.com/${row.repository}`,
          defaultBranch: row.defaultBranch || "main",
          visibility: row.visibility || "UNKNOWN",
          private: row.private === true,
          archived: row.archived === true
        }));
      if (!normalized.some((row) => row.repository === selected)) {
        normalized.unshift({
          repository: selected,
          url: `https://github.com/${selected}`,
          defaultBranch: "main",
          visibility: "LOCAL",
          private: false,
          archived: false
        });
      }
      githubChatState.repositories = normalized;
      githubChatState.selectedRepository = selected;
      renderRepositoryMenu();
      renderGitHubChatStatus(githubChatState.status);
      return normalized;
    })
    .catch((error) => {
      githubNotice(error instanceof Error ? error.message : "GitHub repository list unavailable", "error");
      renderRepositoryMenu();
      return githubChatState.repositories;
    })
    .finally(() => {
      if (githubChatState.repositoryLoading === request) githubChatState.repositoryLoading = null;
    });
  githubChatState.repositoryLoading = request;
  renderRepositoryMenu();
  return request;
}

async function openRepositoryMenu() {
  positionRepositoryMenu();
  githubRepositoryMenu.classList.remove("hidden");
  githubChatButton?.setAttribute("aria-expanded", "true");
  await loadGitHubRepositories(false);
  positionRepositoryMenu();
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
    githubNotice(`GitHub connected. Active repository: ${githubChatState.selectedRepository}`, "success");
    if (githubRepositoryMenu.classList.contains("hidden")) await openRepositoryMenu();
    else closeRepositoryMenu();
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

document.addEventListener("click", (event) => {
  if (githubRepositoryMenu.classList.contains("hidden")) return;
  if (event.target === githubChatButton || githubChatButton?.contains?.(event.target) || githubRepositoryMenu.contains(event.target)) return;
  closeRepositoryMenu();
});

window.addEventListener("resize", () => {
  if (!githubRepositoryMenu.classList.contains("hidden")) positionRepositoryMenu();
});

void loadGitHubChatStatus().then((status) => {
  if (status?.state === "CONNECTED") void loadGitHubRepositories(false);
});
