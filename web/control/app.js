const state = { filter: "all", query: "", tasks: [], activeTaskId: null, request: 0 };

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

function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date).replace(",", "");
}

function row(task) {
  const reason = task.reasonCode ? `<span class="reason-badge" title="${escapeHtml(task.reasonCode)}">${escapeHtml(task.reasonCode)}</span>` : "";
  return `<tr data-task-id="${escapeHtml(task.taskId)}">
    <td><span class="task-id">${escapeHtml(task.taskId)}</span></td>
    <td><span class="status-cell"><span class="status-dot ${tone(task)}"></span><span class="status-label">${escapeHtml(task.displayStatus)}</span>${reason}</span></td>
    <td class="objective" title="${escapeHtml(task.objective)}">${escapeHtml(task.objective)}</td>
    <td class="target" title="${escapeHtml(task.target)}">${escapeHtml(task.target)}</td>
    <td class="initiated" title="${escapeHtml(task.initiatedBy)}">${escapeHtml(task.initiatedBy)}</td>
    <td class="date">${escapeHtml(displayDate(task.createdAt))}</td>
    <td class="date">${escapeHtml(displayDate(task.updatedAt))}</td>
    <td><button class="row-action" type="button" data-action="inspect" aria-label="Inspect ${escapeHtml(task.taskId)}">⋮</button></td>
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
  if (!tr || (!action && event.target.closest("button"))) return;
  const task = state.tasks.find((item) => item.taskId === tr.dataset.taskId);
  if (task) inspectTask(task);
});

$("copyTaskButton").addEventListener("click", async () => {
  if (!state.activeTaskId) return;
  await navigator.clipboard.writeText(state.activeTaskId);
  $("copyTaskButton").textContent = "Copied";
  setTimeout(() => { $("copyTaskButton").textContent = "Copy Task ID"; }, 1000);
});

Promise.all([loadHealth(), loadTasks()]).catch(() => {
  loadTasks();
});
