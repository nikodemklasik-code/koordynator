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
