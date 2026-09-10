const policyModelSelect = document.getElementById("modelSelect");
const policySendButton = document.getElementById("sendButton");
const policyInput = document.getElementById("messageInput");
const policyStatusText = document.getElementById("statusText");
const policyStatusDot = document.getElementById("statusDot");
const policyFooterConnection = document.getElementById("footerConnection");

function billingAllowed() {
  return policyModelSelect?.dataset.billingAllowed === "true";
}

function billingReason() {
  const source = policyModelSelect?.dataset.billingSource || "UNKNOWN";
  if (source === "FREE_REQUESTED") return "Free route is requested but not billing-confirmed";
  if (source === "PAID_API") return "Paid API is blocked by strict billing policy";
  if (source === "UNKNOWN") return "Unknown billing source is blocked";
  return "Billing provenance is not confirmed";
}

function showBlockedReason() {
  const message = billingReason();
  if (policyStatusText) policyStatusText.textContent = message;
  if (policyStatusDot) policyStatusDot.className = "chat-status-dot error";
  if (policyFooterConnection) policyFooterConnection.textContent = "BILLING BLOCKED";
}

function enforceControlState() {
  if (!policySendButton) return;
  if (!billingAllowed()) {
    if (!policySendButton.disabled) policySendButton.disabled = true;
    policySendButton.title = billingReason();
    policySendButton.setAttribute("aria-label", billingReason());
    return;
  }
  policySendButton.title = "Send message";
  policySendButton.setAttribute("aria-label", "Send message");
  const hasPayload = Boolean(policyInput?.value.trim()) || Boolean(document.querySelector("#attachmentTray:not(.hidden) .attachment-chip"));
  const generating = Boolean(document.querySelector("#stopButton:not(.hidden)"));
  const shouldDisable = !hasPayload || generating;
  if (policySendButton.disabled !== shouldDisable) policySendButton.disabled = shouldDisable;
}

window.addEventListener("koordynator:billing-change", () => {
  enforceControlState();
  if (!billingAllowed()) showBlockedReason();
});

document.addEventListener("input", (event) => {
  if (event.target === policyInput) queueMicrotask(enforceControlState);
});

document.addEventListener("click", (event) => {
  if (event.target !== policySendButton || billingAllowed()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showBlockedReason();
}, true);

document.addEventListener("keydown", (event) => {
  if (event.target !== policyInput || event.key !== "Enter" || event.shiftKey || billingAllowed()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showBlockedReason();
}, true);

const policyObserver = new MutationObserver(() => queueMicrotask(enforceControlState));
if (policySendButton) policyObserver.observe(policySendButton, { attributes: true, attributeFilter: ["disabled"] });
enforceControlState();
