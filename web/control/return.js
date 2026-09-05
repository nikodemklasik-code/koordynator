const $ = (id) => document.getElementById(id);
const digestPattern = /^sha256:[a-f0-9]{64}$/i;
let model = null;
let draft = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function taskIdFromPath() {
  return /^\/tasks\/(TASK-[A-Za-z0-9._-]+)\/return$/.exec(location.pathname)?.[1] ?? null;
}

function shortDigest(value, left = 18, right = 10) {
  const text = String(value ?? "—");
  return text.length <= left + right + 1 ? text : `${text.slice(0, left)}…${text.slice(-right)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "—");
  return new Intl.DateTimeFormat("en-GB", {
    year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false, timeZone:"UTC"
  }).format(date).replace(",", "") + " UTC";
}

function reasonMessage(reason) {
  if (String(reason).includes("STALE_POLICY")) return "Evidence was produced under a different policy bundle. Revision N+1 must use the current policy fingerprint and be revalidated.";
  if (/FAIL|VALIDATION/i.test(reason)) return "A required validation or release gate failed. Correct the cause and issue revision N+1.";
  return "The runtime returned this revision. Review the persisted reason before issuing the next WorkOrder.";
}

function actionMessage(action) {
  if (action === "REVALIDATE_WITH_CURRENT_POLICY") return "Old PASS evidence is not reusable. Supply the current policy bundle fingerprint, generate revision N+1, sign it with the owner key, then rerun validation.";
  if (action === "FIX_AND_REVALIDATE") return "Correct the failed scope, generate revision N+1, sign it, rebuild and rerun required validators.";
  return "Review the return reason, generate revision N+1, sign it and rerun the orchestrator.";
}

function renderReceipts(receipts) {
  if (!receipts.length) {
    $("receiptList").innerHTML = '<div class="receipt-mini"><strong>No reusable receipts</strong><code>RETURNED before durable evidence was eligible for reuse.</code></div>';
    return;
  }
  $("receiptList").innerHTML = receipts.map((receipt) => `<article class="receipt-mini">
    <strong><span>${escapeHtml(receipt.gate)}</span><span class="${receipt.status === "PASS" && !receipt.revoked ? "pass" : "fail"}">${escapeHtml(receipt.status)}${receipt.revoked ? " / REVOKED" : ""}</span></strong>
    <code title="${escapeHtml(receipt.receiptFp)}">${escapeHtml(shortDigest(receipt.receiptFp))}</code>
  </article>`).join("");
}

function render(data, health) {
  model = data;
  document.title = `${data.task.taskId} · Targeted Return`;
  $("taskTitle").textContent = data.task.taskId;
  $("revisionTitle").textContent = `revision ${data.revision} · ${data.primaryReason}`;
  $("environmentLabel").textContent = health.environment;
  $("primaryReason").textContent = data.primaryReason;
  $("reasonText").textContent = reasonMessage(data.primaryReason);
  $("failureMeta").innerHTML = [
    ["Task ID", data.task.taskId],
    ["Revision", `R${data.revision}`],
    ["Return reason", data.primaryReason],
    ["Returned at", formatDate(data.returnedAt)],
    ["Candidate", shortDigest(data.candidateSha)],
    ["Artifact", shortDigest(data.artifactFp)]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  $("previousPolicy").textContent = data.previousPolicyFp ?? "—";
  $("currentPolicy").textContent = data.currentPolicyFp ?? "not supplied";
  $("reusableEvidence").textContent = String(data.evidenceReusable);
  $("reusableEvidence").style.color = data.evidenceReusable ? "var(--return-green)" : "var(--return-red)";
  $("requiredAction").textContent = actionMessage(data.requiredAction);
  $("nextTaskId").textContent = data.task.taskId;
  $("nextRevision").textContent = data.nextRevision;
  $("actionLabel").textContent = data.requiredAction;
  $("nextSigned").textContent = data.nextRevisionSigned ? "YES" : "NO";
  $("nextSigned").style.color = data.nextRevisionSigned ? "var(--return-green)" : "var(--return-red)";
  $("nextWorkOrderFp").textContent = data.nextWorkOrderFp ? shortDigest(data.nextWorkOrderFp) : "—";
  $("taskDetailLink").href = `/tasks/${encodeURIComponent(data.task.taskId)}`;
  $("footerTask").textContent = data.task.taskId;
  $("footerRevision").textContent = `R${data.revision}`;
  renderReceipts(data.receipts ?? []);

  if (data.currentPolicyFp) {
    $("policyInput").value = data.currentPolicyFp;
    validatePolicyInput();
  }
  if (data.nextRevisionSigned) {
    $("executionGate").textContent = "SIGNED REVISION AVAILABLE";
    $("executionGate").style.color = "var(--return-green)";
    $("copyRunButton").disabled = false;
  }
}

function validatePolicyInput() {
  if (!model) return false;
  const value = $("policyInput").value.trim();
  const stale = model.reasons.some((reason) => String(reason).includes("STALE_POLICY"));
  if (!value && stale) {
    $("policyValidation").textContent = "Current policy fingerprint is required for STALE_POLICY recovery.";
    $("policyValidation").className = "validation-message fail";
    $("generateButton").disabled = true;
    return false;
  }
  if (value && !digestPattern.test(value)) {
    $("policyValidation").textContent = "Fingerprint must be sha256:<64 hex>.";
    $("policyValidation").className = "validation-message fail";
    $("generateButton").disabled = true;
    return false;
  }
  $("policyValidation").textContent = value ? "Fingerprint format valid." : "Existing policy may be reused for this return reason.";
  $("policyValidation").className = "validation-message pass";
  $("generateButton").disabled = false;
  return true;
}

async function generateDraft() {
  if (!model || !validatePolicyInput()) return;
  const policyFp = $("policyInput").value.trim();
  const params = new URLSearchParams();
  if (policyFp) params.set("policyFp", policyFp);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/tasks/${encodeURIComponent(model.task.taskId)}/next-work-order${suffix}`, { headers: { accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `NEXT_WORK_ORDER_HTTP_${response.status}`);
  draft = payload.draft;
  $("downloadDraftButton").disabled = false;
  $("copySignButton").disabled = false;
  $("policyValidation").textContent = `Revision ${draft.revision} generated in memory. It has not been persisted or signed.`;
  $("policyValidation").className = "validation-message pass";
}

function downloadDraft() {
  if (!draft) return;
  const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${draft.taskId}.r${draft.revision}.work-order.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(text, button, done) {
  await navigator.clipboard.writeText(text);
  const before = button.textContent;
  button.textContent = done;
  setTimeout(() => { button.textContent = before; }, 1000);
}

function signCommand() {
  if (!draft) return "";
  const input = `${draft.taskId}.r${draft.revision}.work-order.json`;
  const output = `${draft.taskId}.r${draft.revision}.signed.json`;
  return `orchestrator sign ${input} --private-key owner.pem --key-id owner --out ${output}`;
}

function runCommand() {
  if (!model) return "";
  return `orchestrator run run-r${model.nextRevision}.json --public-key owner.pub --release-key release.pem`;
}

function showFatal(error) {
  $("fatalErrorText").textContent = error instanceof Error ? error.message : String(error);
  $("fatalError").classList.remove("hidden");
}

async function boot() {
  const taskId = taskIdFromPath();
  if (!taskId) throw new Error("INVALID_TARGETED_RETURN_ROUTE");
  const [healthResponse, returnResponse] = await Promise.all([
    fetch("/api/health", { headers: { accept: "application/json" } }),
    fetch(`/api/tasks/${encodeURIComponent(taskId)}/return`, { headers: { accept: "application/json" } })
  ]);
  if (!healthResponse.ok) throw new Error(`HEALTH_HTTP_${healthResponse.status}`);
  const returned = await returnResponse.json();
  if (!returnResponse.ok) throw new Error(returned.error ?? `TARGETED_RETURN_HTTP_${returnResponse.status}`);
  render(returned, await healthResponse.json());

  $("policyInput").addEventListener("input", validatePolicyInput);
  $("generateButton").addEventListener("click", () => generateDraft().catch(showFatal));
  $("downloadDraftButton").addEventListener("click", downloadDraft);
  $("copySignButton").addEventListener("click", () => copyText(signCommand(), $("copySignButton"), "Copied"));
  $("copyRunButton").addEventListener("click", () => copyText(runCommand(), $("copyRunButton"), "Copied"));
  validatePolicyInput();
}

boot().catch(showFatal);
