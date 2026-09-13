#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function patch(path, from, to, label) {
  const source = readFileSync(path, "utf8");
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return;
  }
  if (!source.includes(from)) {
    throw new Error(`${label}: expected source block not found`);
  }
  writeFileSync(path, source.replace(from, to), "utf8");
  console.log(`${label}: patched`);
}

patch(
  "src/control/server.ts",
  '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  '          version: options.version ?? VERSION,\n          chatDefaultModel: options.chatDefaultModel ?? null,\n          chatFallbackModels: options.chatFallbackModels ?? [],\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  "health exposes configured swarm route"
);

patch(
  "web/control/chat-models.js",
  '    const usableIds = usable.map((entry) => entry.id);\n    const preferred = usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = await desiredSessionModel(usableIds, preferred);',
  '    const usableIds = usable.map((entry) => entry.id);\n    const configuredDefault = typeof health.chatDefaultModel === "string" && usableIds.includes(health.chatDefaultModel)\n      ? health.chatDefaultModel\n      : null;\n    const preferred = configuredDefault\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    // The startup swarm has already live-probed chatDefaultModel. Honor that exact\n    // route even when an older persistent session remembers a subscription model.\n    const desired = configuredDefault || await desiredSessionModel(usableIds, preferred);',
  "model picker honors live-probed swarm primary"
);

patch(
  "web/control/chat-usage.js",
  '    usage24h.textContent = `24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`;',
  '    usage24h.textContent = `USED 24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`;',
  "usage badge says used, not balance"
);

patch(
  "web/control/chat-usage.js",
  '      "Token totals include only provider-reported usage. No estimates are presented as facts."',
  '      "These are tokens USED in the last 24 hours, not remaining quota or token balance.",\n      "No-auth/free providers often expose rate limits rather than a remaining-token balance.",\n      "Token totals include only provider-reported usage. No estimates are presented as facts."',
  "usage tooltip explains quota semantics"
);

console.log("FREE_FIRST_CONTROL_PATCH=PASS");
