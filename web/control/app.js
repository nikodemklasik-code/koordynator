const state = { filter: "all", query: "", tasks: [], repositories: [], activeTaskId: null, request: 0 };

const $ = (id) => document.getElementById(id);
const taskRows = $("taskRows");
const loadingState = $("loadingState");
const emptyState = $("emptyState");
const searchInput = $("searchInput");
const refreshButton = $("refreshButton");
const filterRow = $("filterRow");
const taskDialog = $("taskDialog");
const newTaskDialog = $("newTaskDialog");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tone(task) {
  if (task.state === "RELEASED") return "green";
  if (["RETURNED", "FAILED", "QUARANTINED"].includes(task.state)) return "red";
  if (["VALIDATING", "APPROVED", "RELEASING"].includes(task.state)) return "blue";
  if (task.state === "BLOCKED") return "amber";
  return "";
}

function taskRoute(task) {
  const base = `/tasks/${encodeURIComponent(task.taskId)}`;
  return task.state === "RETURNED" ? `${base}/return` : base;
}

function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date).replace(",", "");
}

function row(task) {
  const reason = task.reasonCode ? `<span class="reason-badge" title="${escapeHtml(task.reasonCode)}">${escapeHtml(task.reasonCode)}</span>` : "";
  const taskHref = taskRoute(task);
  return `<tr data-task-id="${escapeHtml(task.taskId)}" tabindex="0" aria-label="Open ${escapeHtml(task.taskId)}">
    <td><a class="task-id task-link" style="color:inherit;text-decoration:none" href="${taskHref}">${escapeHtml(task.taskId)}</a></td>
    <td><span class="status-cell"><span class="status-dot ${tone(task)}"></span><span class="status-label">${escapeHtml(task.displayStatus)}</span>${reason}</span></td>
    <td class="objective" title="${escapeHtml(task.objective)}">${escapeHtml(task.objective)}</td>
    <td class="target" title="${escapeHtml(task.target)}">${escapeHtml(task.target)}</td>
    <td class="initiated" title="${escapeHtml(task.initiatedBy)}">${escapeHtml(task.initiatedBy)}</td>
    <td class="date">${escapeHtml(displayDate(task.createdAt))}</td>
    <td class="date">${escapeHtml(displayDate(task.updatedAt))}</td>
    <td><button class="row-action" type="button" data-action="inspect" aria-label="Quick inspect ${escapeHtml(task.taskId)}">⋮</button></td>
  </tr>`;
}

function updateCounts(counts) {
  $("countAll").textContent = counts.all;
  $("countBuilding").textContent = counts.building;
  $("countFrozen").textContent = counts.frozen;
  $("countValidating").textContent = counts.validating;
  $("countApproval").textContent = counts.awaitingApproval;
  $("countReleased").textContent = counts.released;
  $("countReturned").textContent = counts.returned;
}

function renderTasks(payload) {
  state.tasks = payload.tasks;
  updateCounts(payload.counts);
  taskRows.innerHTML = payload.tasks.map(row).join("");
  loadingState.classList.add("hidden");
  emptyState.classList.toggle("hidden", payload.tasks.length !== 0);
}

async function loadTasks() {
  const requestId = ++state.request;
  refreshButton.classList.add("refreshing");
  const params = new URLSearchParams({ status: state.filter });
  if (state.query) params.set("q", state.query);
  try {
    const response = await fetch(`/api/tasks?${params.toString()}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`TASKS_HTTP_${response.status}`);
    const payload = await response.json();
    if (requestId === state.request) renderTasks(payload);
  } catch (error) {
    if (requestId !== state.request) return;
    loadingState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.querySelector("strong").textContent = "Tasks unavailable";
    emptyState.querySelector("span:last-child").textContent = error instanceof Error ? error.message : "Control API error";
  } finally {
    refreshButton.classList.remove("refreshing");
  }
}

async function loadHealth() {
  const response = await fetch("/api/health", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`);
  const health = await response.json();
  $("environmentLabel").textContent = health.environment;
  $("sidebarEnv").textContent = health.environment;
  $("footerEnv").textContent = health.environment;
  $("operatorLabel").textContent = health.operator;
  $("regionLabel").textContent = health.region;
  $("zoneLabel").textContent = health.zone;
  $("versionLabel").textContent = `v${health.version}`;
  $("ciStatus").textContent = health.ciVerify;
  $("ciStatus").className = `status-badge ${health.ciVerify === "PASS" ? "pass" : health.ciVerify === "FAIL" ? "fail" : "neutral"}`;
  $("ciRing").className = `status-ring ${health.ciVerify === "PASS" ? "pass" : health.ciVerify === "FAIL" ? "fail" : ""}`;
  $("ciRing").textContent = health.ciVerify === "FAIL" ? "×" : "✓";
}

function inspectTask(task) {
  state.activeTaskId = task.taskId;
  $("dialogTitle").textContent = task.taskId;
  $("dialogBody").innerHTML = `<dl class="dialog-grid">
    <dt>Status</dt><dd>${escapeHtml(task.displayStatus)}${task.reasonCode ? ` · ${escapeHtml(task.reasonCode)}` : ""}</dd>
    <dt>Revision</dt><dd>${escapeHtml(task.revision)}</dd>
    <dt>Objective</dt><dd>${escapeHtml(task.objective)}</dd>
    <dt>Target</dt><dd>${escapeHtml(task.target)}</dd>
    <dt>Initiated by</dt><dd>${escapeHtml(task.initiatedBy)}</dd>
    <dt>Workspace</dt><dd>${escapeHtml(task.workspaceId)}</dd>
    <dt>Build ID</dt><dd>${escapeHtml(task.buildId)}</dd>
    <dt>WorkOrder FP</dt><dd>${escapeHtml(task.workOrderFp ?? "not available")}</dd>
    <dt>Created</dt><dd>${escapeHtml(displayDate(task.createdAt))}</dd>
    <dt>Updated</dt><dd>${escapeHtml(displayDate(task.updatedAt))}</dd>
  </dl>`;
  const actions = taskDialog.querySelector(".dialog-actions");
  let openButton = $("openTaskButton");
  if (!openButton) {
    openButton = document.createElement("button");
    openButton.id = "openTaskButton";
    openButton.type = "button";
    openButton.className = "primary-button";
    actions.insertBefore(openButton, actions.lastElementChild);
  }
  openButton.textContent = task.state === "RETURNED" ? "Open Targeted Return" : "Open Task Detail";
  openButton.onclick = () => { location.href = taskRoute(task); };
  taskDialog.showModal();
}

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = searchInput.value.trim();
    loadTasks();
  }, 180);
});

filterRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  filterRow.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  loadTasks();
});

$("filtersButton").addEventListener("click", () => filterRow.scrollIntoView({ behavior: "smooth", block: "nearest" }));
refreshButton.addEventListener("click", loadTasks);
$("newTaskButton").addEventListener("click", () => newTaskDialog.showModal());
$("fullscreenButton").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});

taskRows.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action='inspect']");
  const tr = event.target.closest("tr[data-task-id]");
  if (!tr) return;
  const task = state.tasks.find((item) => item.taskId === tr.dataset.taskId);
  if (!task) return;
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    inspectTask(task);
    return;
  }
  if (!event.target.closest("a,button")) location.href = taskRoute(task);
});

taskRows.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("a,button")) return;
  const tr = event.target.closest("tr[data-task-id]");
  if (!tr) return;
  const task = state.tasks.find((item) => item.taskId === tr.dataset.taskId);
  if (!task) return;
  event.preventDefault();
  location.href = taskRoute(task);
});

$("copyTaskButton").addEventListener("click", async () => {
  if (!state.activeTaskId) return;
  await navigator.clipboard.writeText(state.activeTaskId);
  $("copyTaskButton").textContent = "Copied";
  setTimeout(() => { $("copyTaskButton").textContent = "Copy Task ID"; }, 1000);
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("PROJECT_PACK_READ_FAILED"));
    reader.onerror = () => reject(reader.error || new Error("PROJECT_PACK_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

$("projectPackInput")?.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;
  try {
    const payload = [];
    for (const file of files) {
      payload.push({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: await fileToDataUrl(file)
      });
    }
    const response = await fetch("/api/tasks/project-pack", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ files: payload })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `PROJECT_PACK_HTTP_${response.status}`);
    $("newTaskDialog").showModal();
    const note = document.createElement("p");
    note.textContent = `Project pack ${body.packId} stored. Objective hint: ${body.objectiveHint}`;
    $("newTaskDialog").querySelector(".dialog-body")?.prepend(note);
  } catch (error) {
    emptyState.classList.remove("hidden");
    emptyState.querySelector("strong").textContent = "Project pack failed";
    emptyState.querySelector("span:last-child").textContent = error instanceof Error ? error.message : "Upload failed";
  }
});

const repositoryDialog = $("repositoryDialog");
const repositoryList = $("repositoryList");
const repositoryError = $("repositoryError");

const REPOSITORY_ERRORS = {
  REPOSITORY_INVALID: "Use owner/name or a github.com repository URL.",
  REPOSITORY_BRANCH_INVALID: "Branch name contains unsupported characters.",
  REPOSITORY_NOTES_INVALID: "Notes are too long or contain control characters.",
  REPOSITORY_ALREADY_REGISTERED: "This repository is already registered.",
  REPOSITORY_NOT_REGISTERED: "This repository is not registered.",
  REPOSITORY_REGISTRY_FULL: "Repository registry is full."
};

function repositoryMessage(code) {
  return REPOSITORY_ERRORS[code] || code || "Repository registration failed";
}

function renderRepositories(repositories) {
  state.repositories = repositories;
  if (!repositories.length) {
    repositoryList.innerHTML = '<span class="repository-empty">No repositories registered yet.</span>';
    return;
  }
  repositoryList.innerHTML = repositories.map((item) => {
    const branch = item.defaultBranch ? `<span class="repository-branch">${escapeHtml(item.defaultBranch)}</span>` : "";
    const title = item.notes ? ` title="${escapeHtml(item.notes)}"` : "";
    return `<span class="repository-chip"${title}>
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(item.repositoryId)}</a>${branch}
      <button type="button" class="repository-remove" data-repository="${escapeHtml(item.repositoryId)}" aria-label="Remove ${escapeHtml(item.repositoryId)}">×</button>
    </span>`;
  }).join("");
}

async function loadRepositories() {
  try {
    const response = await fetch("/api/repositories", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`REPOSITORIES_HTTP_${response.status}`);
    const payload = await response.json();
    renderRepositories(payload.repositories || []);
  } catch {
    repositoryList.innerHTML = '<span class="repository-empty">Repository registry unavailable.</span>';
  }
}

function showRepositoryError(message) {
  repositoryError.textContent = message;
  repositoryError.classList.toggle("hidden", !message);
}

$("addRepositoryButton")?.addEventListener("click", () => {
  showRepositoryError("");
  $("repositoryInput").value = "";
  $("repositoryBranchInput").value = "";
  $("repositoryNotesInput").value = "";
  repositoryDialog.showModal();
  $("repositoryInput").focus();
});

async function registerRepository() {
  const repository = $("repositoryInput").value.trim();
  if (!repository) return showRepositoryError(repositoryMessage("REPOSITORY_INVALID"));
  const branch = $("repositoryBranchInput").value.trim();
  const notes = $("repositoryNotesInput").value.trim();
  const body = { repository };
  if (branch) body.defaultBranch = branch;
  if (notes) body.notes = notes;
  try {
    const response = await fetch("/api/repositories", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return showRepositoryError(repositoryMessage(payload.error));
    renderRepositories(payload.repositories || []);
    showRepositoryError("");
    repositoryDialog.close();
  } catch (error) {
    showRepositoryError(error instanceof Error ? error.message : "Repository registration failed");
  }
}

$("repositorySubmit")?.addEventListener("click", registerRepository);
$("repositoryInput")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  registerRepository();
});

repositoryList?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-repository]");
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/repositories/remove", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ repository: button.dataset.repository })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(repositoryMessage(payload.error));
    renderRepositories(payload.repositories || []);
  } catch {
    button.disabled = false;
    await loadRepositories();
  }
});

Promise.all([loadHealth(), loadTasks(), loadRepositories()]).catch(() => {
  loadTasks();
  loadRepositories();
});
