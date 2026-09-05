const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC"
  }).format(date).replace(",", "") + " UTC";
}

function shortDigest(value, left = 18, right = 10) {
  const text = String(value ?? "—");
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function tone(status) {
  if (["PASS", "RELEASED", "PRODUCTION", "FROZEN"].includes(status)) return "pass";
  if (["FAIL", "FAILED", "RETURNED", "QUARANTINED", "EXPIRED"].includes(status)) return "fail";
  if (["APPROVED", "VALIDATING", "RELEASING", "AWAITING_HUMAN_APPROVAL"].includes(status)) return "info";
  if (["BLOCKED", "UNEXECUTED"].includes(status)) return "warn";
  return "neutral";
}

function taskIdFromPath() {
  const match = /^\/tasks\/(TASK-[A-Za-z0-9._-]+)$/.exec(location.pathname);
  return match?.[1] ?? null;
}

function renderHealth(health) {
  $("operatorLabel").textContent = health.operator;
  $("environmentLabel").textContent = health.environment;
}

function renderLifecycle(history) {
  const rail = $("lifecycleRail");
  if (!history.length) {
    rail.innerHTML = '<li class="lifecycle-empty">No persisted state history.</li>';
    return;
  }
  const currentIndex = history.length - 1;
  rail.innerHTML = history.map((item, index) => {
    const current = index === currentIndex;
    const stateTone = tone(item.state);
    return `<li class="lifecycle-step ${current ? "current" : ""} ${stateTone}">
      <span class="rail-node"></span>
      <div><strong>${escapeHtml(item.state)}</strong><time>${escapeHtml(formatDate(item.changedAt))}</time>${item.reasonCode ? `<small>${escapeHtml(item.reasonCode)}</small>` : ""}</div>
    </li>`;
  }).join("");
}

function renderSummary(detail) {
  const task = detail.task;
  $("pageTitle").textContent = `TASK DETAIL: ${task.taskId}`;
  $("revisionLabel").textContent = `revision ${task.revision}`;
  $("taskTitle").textContent = task.taskId;
  $("revisionInline").textContent = `revision ${task.revision}`;
  $("taskObjective").textContent = task.objective;
  $("buildMeta").textContent = `Build: ${task.buildId}`;
  $("workspaceMeta").textContent = `Workspace: ${task.workspaceId}`;
  $("heroStatus").textContent = task.displayStatus;
  $("heroStatus").className = `hero-status ${tone(task.displayStatus)}`;
  $("heroSubstatus").textContent = task.reasonCode ? `Reason: ${task.reasonCode}` : "Persisted runtime state";

  if (detail.workOrder) {
    $("workOrderSummary").textContent = "Signed envelope stored";
    $("workOrderBadge").textContent = "SIGNED";
    $("workOrderBadge").className = "summary-badge pass";
    $("workOrderFoot").textContent = `Key: ${detail.workOrder.keyId} · ${shortDigest(detail.workOrder.orderFp)}`;
  } else {
    $("workOrderSummary").textContent = "Signed envelope not available";
    $("workOrderBadge").textContent = "MISSING";
    $("workOrderBadge").className = "summary-badge fail";
    $("workOrderFoot").textContent = "Control plane cannot claim signature evidence.";
  }

  if (detail.candidate) {
    $("freezeSummary").textContent = "Immutable candidate recorded";
    $("freezeBadge").textContent = "FROZEN";
    $("freezeBadge").className = "summary-badge amber";
    $("freezeFoot").textContent = `Frozen ${formatDate(detail.candidate.frozenAt)}`;
  } else {
    $("freezeSummary").textContent = "Candidate not yet persisted";
    $("freezeBadge").textContent = "OPEN";
    $("freezeBadge").className = "summary-badge neutral";
    $("freezeFoot").textContent = "No frozen candidate is available for this revision.";
  }

  const receipts = detail.receipts ?? [];
  const passed = receipts.length > 0 && receipts.every((receipt) => receipt.status === "PASS" && receipt.revoked !== true);
  $("evidenceSummary").textContent = receipts.length === 0 ? "No persisted validator receipts" : passed ? "All persisted receipts PASS" : "One or more receipts block release";
  $("evidenceBadge").textContent = receipts.length === 0 ? "NONE" : passed ? "PASS" : "CHECK";
  $("evidenceBadge").className = `summary-badge ${receipts.length === 0 ? "neutral" : passed ? "pass" : "fail"}`;
  $("evidenceFoot").textContent = receipts.length === 0 ? "Receipts appear after validation." : `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} persisted`;
}

function property(label, value, title = "") {
  return `<div class="property-row"><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(title || value)}">${escapeHtml(value)}</dd></div>`;
}

function renderProperties(detail) {
  const task = detail.task;
  const order = detail.workOrder?.order;
  const rows = [
    property("TASK ID", task.taskId),
    property("REVISION", task.revision),
    property("WORKSPACE", task.workspaceId),
    property("BUILD ID", task.buildId),
    property("TARGET", task.target),
    property("INITIATED BY", task.initiatedBy),
    property("CREATED", formatDate(task.createdAt)),
    property("UPDATED", formatDate(task.updatedAt))
  ];
  if (order) {
    rows.push(property("POLICY", order.policyRef.policyId));
    rows.push(property("POLICY FP", shortDigest(order.policyRef.bundleHash), order.policyRef.bundleHash));
    rows.push(property("REQUIRED GATES", order.requiredGates.join(", ") || "none"));
    rows.push(property("APPROVAL", order.humanApprovalPolicy));
  }
  $("taskProperties").innerHTML = rows.join("");
}

function renderLock(detail) {
  const candidate = detail.candidate;
  if (!candidate) {
    $("lockContent").innerHTML = `<div class="lock-state neutral"><span class="lock-glyph">○</span><strong>NO FROZEN CANDIDATE</strong></div><p>This revision has not reached a persisted candidate freeze point.</p>`;
    return;
  }
  $("lockContent").innerHTML = `<div class="lock-state amber"><span class="lock-glyph">▣</span><strong>CANDIDATE_FROZEN</strong></div>
    <p>This candidate manifest is the immutable identity used by validation and release checks.</p>
    <div class="hash-block"><small>CANDIDATE SHA</small><code title="${escapeHtml(candidate.candidateSha)}">${escapeHtml(shortDigest(candidate.candidateSha, 24, 14))}</code></div>
    <div class="hash-block"><small>ARTIFACT FP</small><code title="${escapeHtml(candidate.artifactFp)}">${escapeHtml(shortDigest(candidate.artifactFp, 24, 14))}</code></div>
    <div class="lock-time">LOCK TIME: ${escapeHtml(formatDate(candidate.frozenAt))}</div>`;
}

function renderManifest(detail) {
  const candidate = detail.candidate;
  const card = $("manifestCard");
  if (!candidate) {
    card.classList.add("manifest-empty");
    $("manifestGrid").innerHTML = '<div class="manifest-placeholder">Candidate manifest is not available for this revision.</div>';
    $("copyCandidateButton").disabled = true;
    return;
  }
  card.classList.remove("manifest-empty");
  const entries = [
    ["candidateSha", candidate.candidateSha],
    ["artifactFp", candidate.artifactFp],
    ["sourceFp", candidate.sourceFp],
    ["dependencyFp", candidate.dependencyFp],
    ["configFp", candidate.configFp],
    ["toolchainFp", candidate.toolchainFp],
    ["buildEnvironmentFp", candidate.buildEnvironmentFp],
    ["moduleManifestFp", candidate.moduleManifestFp]
  ];
  $("manifestGrid").innerHTML = entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd><code title="${escapeHtml(value)}">${escapeHtml(shortDigest(value, 22, 12))}</code></dd></div>`).join("");
  $("copyCandidateButton").disabled = false;
  $("copyCandidateButton").onclick = async () => {
    await navigator.clipboard.writeText(candidate.candidateSha);
    $("copyCandidateButton").textContent = "COPIED";
    setTimeout(() => { $("copyCandidateButton").textContent = "COPY CANDIDATE SHA"; }, 900);
  };
}

function renderReceipts(detail) {
  const receipts = detail.receipts ?? [];
  $("receiptCount").textContent = receipts.length;
  if (receipts.length === 0) {
    $("receiptList").innerHTML = '<div class="receipt-empty"><strong>No receipts persisted</strong><span>Validation has not produced durable evidence for this revision.</span></div>';
    return;
  }
  $("receiptList").innerHTML = receipts.map((receipt) => `<article class="receipt-card ${tone(receipt.status)}">
    <div class="receipt-head"><span class="receipt-check">${receipt.status === "PASS" ? "✓" : receipt.status === "UNEXECUTED" ? "!" : "×"}</span><strong>${escapeHtml(receipt.gate)}</strong><span class="receipt-status">${escapeHtml(receipt.status)}</span></div>
    <p>${escapeHtml(receipt.kind)} evidence</p>
    <dl><div><dt>Receipt</dt><dd title="${escapeHtml(receipt.receiptFp)}">${escapeHtml(shortDigest(receipt.receiptFp))}</dd></div><div><dt>Valid until</dt><dd>${escapeHtml(formatDate(receipt.validUntil))}</dd></div><div><dt>Revoked</dt><dd>${receipt.revoked ? "YES" : "NO"}</dd></div></dl>
  </article>`).join("");
}

function renderFooter(detail) {
  $("buildModeLabel").textContent = detail.buildMode ?? "UNKNOWN";
  $("executionStatusLabel").textContent = detail.executionStatus ?? detail.task.displayStatus;
  const candidate = detail.candidate;
  const release = detail.release;
  if (!candidate) {
    $("integrityLabel").textContent = "NO FROZEN CANDIDATE";
    $("attestationStrip").className = "attestation-strip neutral";
    return;
  }
  if (release) {
    const exact = release.release.manifest.candidateSha === candidate.candidateSha && release.release.manifest.artifactFp === candidate.artifactFp;
    $("integrityLabel").textContent = exact ? "RELEASE MATCHES FROZEN CANDIDATE" : "RELEASE MISMATCH";
    $("attestationStrip").className = `attestation-strip ${exact ? "pass" : "fail"}`;
    return;
  }
  $("integrityLabel").textContent = "FROZEN; NOT RELEASED";
  $("attestationStrip").className = "attestation-strip amber";
}

function renderAudit(detail) {
  const history = detail.history ?? [];
  $("auditTitle").textContent = `${detail.task.taskId} · revision ${detail.task.revision}`;
  $("auditBody").innerHTML = history.length === 0 ? '<p class="muted">No state history persisted.</p>' : history.map((item, index) => `<div class="audit-row">
    <span class="audit-index">${String(index + 1).padStart(2, "0")}</span>
    <div><strong>${escapeHtml(item.state)}</strong>${item.reasonCode ? `<small>${escapeHtml(item.reasonCode)}</small>` : ""}</div>
    <time>${escapeHtml(formatDate(item.changedAt))}</time>
  </div>`).join("");
}

function render(detail) {
  document.title = `${detail.task.taskId} · Koordynator Control`;
  renderLifecycle(detail.history ?? []);
  renderSummary(detail);
  renderProperties(detail);
  renderLock(detail);
  renderManifest(detail);
  renderReceipts(detail);
  renderFooter(detail);
  renderAudit(detail);
}

function showFatal(error) {
  $("fatalErrorText").textContent = error instanceof Error ? error.message : String(error);
  $("fatalError").classList.remove("hidden");
}

async function boot() {
  const taskId = taskIdFromPath();
  if (!taskId) throw new Error("INVALID_TASK_ROUTE");
  const [healthResponse, detailResponse] = await Promise.all([
    fetch("/api/health", { headers: { accept: "application/json" } }),
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/detail`, { headers: { accept: "application/json" } })
  ]);
  if (!healthResponse.ok) throw new Error(`HEALTH_HTTP_${healthResponse.status}`);
  if (!detailResponse.ok) throw new Error(detailResponse.status === 404 ? "TASK_NOT_FOUND" : `TASK_DETAIL_HTTP_${detailResponse.status}`);
  renderHealth(await healthResponse.json());
  const detail = await detailResponse.json();
  render(detail);
  $("auditButton").addEventListener("click", () => $("auditDialog").showModal());
}

boot().catch(showFatal);
