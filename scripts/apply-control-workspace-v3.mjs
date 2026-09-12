#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BRANCH = "origin/fix/local-control-ui-redesign";

function read(path) { return readFileSync(path, "utf8"); }
function write(path, value) { writeFileSync(path, value, "utf8"); }
function asset(path) { return execFileSync("git", ["show", `${BRANCH}:${path}`], { encoding: "utf8" }); }

function replaceOnce(path, from, to, label) {
  let source = read(path);
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return;
  }
  if (!source.includes(from)) throw new Error(`${label}: expected source block not found`);
  source = source.replace(from, to);
  write(path, source);
  console.log(`${label}: patched`);
}

write("web/control/control-workspace-v3.css", asset("web/control/control-workspace-v3.css"));
write("web/control/control-workspace-v3.js", asset("web/control/control-workspace-v3.js"));
console.log("workspace assets: installed");

// Ensure Control exposes the startup swarm source-of-truth.
replaceOnce(
  "src/control/server.ts",
  '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  '          version: options.version ?? VERSION,\n          chatDefaultModel: options.chatDefaultModel ?? null,\n          chatFallbackModels: options.chatFallbackModels ?? [],\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  "health primary/fallbacks"
);

// Free routes sort before subscription routes.
replaceOnce(
  "web/control/chat-models.js",
  'const SOURCE_ORDER = {\n  SUBSCRIPTION_HARNESS: 0,\n  FREE_OAUTH: 1,\n  FREE_CONFIRMED: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};',
  'const SOURCE_ORDER = {\n  FREE_CONFIRMED: 0,\n  FREE_OAUTH: 1,\n  SUBSCRIPTION_HARNESS: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};',
  "free-first model ordering"
);

// Honor live-probed backend primary instead of an older persistent session.
const modelPath = "web/control/chat-models.js";
let modelSource = read(modelPath);
const oldPreference = '    const usableIds = usable.map((entry) => entry.id);\n    const preferred = usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = await desiredSessionModel(usableIds, preferred);';
const newPreference = '    const usableIds = usable.map((entry) => entry.id);\n    const configuredDefault = typeof health.chatDefaultModel === "string" && usableIds.includes(health.chatDefaultModel)\n      ? health.chatDefaultModel\n      : null;\n    const preferred = configuredDefault\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = configuredDefault || await desiredSessionModel(usableIds, preferred);';
if (modelSource.includes(newPreference)) {
  console.log("backend primary selection: already applied");
} else if (modelSource.includes(oldPreference)) {
  write(modelPath, modelSource.replace(oldPreference, newPreference));
  console.log("backend primary selection: patched");
} else if (modelSource.includes("const configuredDefault = typeof health.chatDefaultModel")) {
  console.log("backend primary selection: compatible patch already present");
} else {
  throw new Error("backend primary selection: expected source block not found");
}

// Hermes is a drawer, closed by default on first use.
const chatPath = "web/control/chat.js";
let chatSource = read(chatPath);
chatSource = chatSource.replace(
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż terminal" : "Wycisz terminal";',
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Hermes" : "Zamknij Hermes";'
);
const oldMute = 'try { state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch { state.hermesMuted = false; }';
const newMute = 'try { const storedHermes = localStorage.getItem(MUTE_KEY); state.hermesMuted = storedHermes === null ? true : storedHermes === "1"; } catch { state.hermesMuted = true; }';
if (chatSource.includes(oldMute)) chatSource = chatSource.replace(oldMute, newMute);
write(chatPath, chatSource);
console.log("Hermes drawer default: patched");

// Make the usage label impossible to confuse with remaining balance.
const usagePath = "web/control/chat-usage.js";
let usageSource = read(usagePath);
usageSource = usageSource.replace(
  '`24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`',
  '`USED 24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`'
);
if (!usageSource.includes("These are tokens USED in the last 24 hours")) {
  usageSource = usageSource.replace(
    '      "Token totals include only provider-reported usage. No estimates are presented as facts."',
    '      "These are tokens USED in the last 24 hours, not remaining quota or token balance.",\n      "No-auth/free providers often expose rate limits rather than a remaining-token balance.",\n      "Token totals include only provider-reported usage. No estimates are presented as facts."'
  );
}
write(usagePath, usageSource);
console.log("usage semantics: patched");

// Load the workspace override last so older inline/layout CSS cannot win accidentally.
const htmlPath = "web/control/chat.html";
let html = read(htmlPath);
if (!html.includes("/control-workspace-v3.css")) {
  html = html.replace("</head>", '  <link rel="stylesheet" href="/control-workspace-v3.css?v=3" />\n</head>');
}
if (!html.includes("/control-workspace-v3.js")) {
  html = html.replace("</body>", '  <script src="/control-workspace-v3.js?v=3" defer></script>\n</body>');
}
write(htmlPath, html);
console.log("workspace v3 hooks: installed");

const checks = [
  ["web/control/chat.html", "control-workspace-v3.css?v=3"],
  ["web/control/chat.html", "control-workspace-v3.js?v=3"],
  ["web/control/chat-models.js", "FREE_CONFIRMED: 0"],
  ["web/control/chat-models.js", "health.chatDefaultModel"],
  ["web/control/chat.js", "storedHermes === null ? true"],
  ["src/control/server.ts", "chatDefaultModel: options.chatDefaultModel"],
  ["web/control/chat-usage.js", "USED 24H"]
];
for (const [path, marker] of checks) {
  if (!read(path).includes(marker)) throw new Error(`VERIFY_FAIL ${path} missing ${marker}`);
}
console.log("CONTROL_WORKSPACE_V3=PASS");
