#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BRANCH = "origin/redesign/live-chat-v5";

function read(path) { return readFileSync(path, "utf8"); }
function write(path, value) { writeFileSync(path, value, "utf8"); }
function asset(path) { return execFileSync("git", ["show", `${BRANCH}:${path}`], { encoding: "utf8" }); }

function replaceIfPresent(path, from, to, label) {
  let source = read(path);
  if (source.includes(to)) {
    console.log(`${label}: already applied`);
    return true;
  }
  if (!source.includes(from)) return false;
  source = source.replace(from, to);
  write(path, source);
  console.log(`${label}: patched`);
  return true;
}

function requireMarker(path, marker, label) {
  if (!read(path).includes(marker)) throw new Error(`${label}: missing ${marker}`);
}

// Replace the whole Live Chat view. No inherited V3/V4 markup survives this step.
for (const path of ["web/control/chat.html", "web/control/chat-v5.css", "web/control/chat-v5.js"]) {
  write(path, asset(path));
  console.log(`${path}: installed`);
}

// Health is the source of truth for the live-probed swarm route.
const serverPath = "src/control/server.ts";
const healthOld = '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",';
const healthNew = '          version: options.version ?? VERSION,\n          chatDefaultModel: options.chatDefaultModel ?? null,\n          chatFallbackModels: options.chatFallbackModels ?? [],\n          liveChatBillingPolicy: "STRICT_PROVENANCE",';
if (!replaceIfPresent(serverPath, healthOld, healthNew, "health route truth")) {
  requireMarker(serverPath, "chatDefaultModel: options.chatDefaultModel", "health route truth");
  requireMarker(serverPath, "chatFallbackModels: options.chatFallbackModels", "health route truth");
  console.log("health route truth: compatible patch already present");
}

// Catalog no-auth routes as confirmed free routes. The free-swarm bootstrap live-probes
// them before selecting one as startup primary; these prefixes are not PAYG routes.
const catalogPath = "src/control/chat-model-catalog.ts";
let catalog = read(catalogPath);
if (!catalog.includes('oc: { provider: "opencode-free"')) {
  const anchor = '  "qwen-oauth": { provider: "qwen-oauth", family: "QWEN", source: "FREE_OAUTH" }\n};';
  if (!catalog.includes(anchor)) throw new Error("catalog no-auth prefixes: anchor not found");
  catalog = catalog.replace(anchor,
    '  "qwen-oauth": { provider: "qwen-oauth", family: "QWEN", source: "FREE_OAUTH" },\n' +
    '  oc: { provider: "opencode-free", family: "OPENCODE FREE", source: "FREE_CONFIRMED" },\n' +
    '  ddgw: { provider: "duckduckgo-free", family: "DUCKDUCKGO FREE", source: "FREE_CONFIRMED" },\n' +
    '  unc: { provider: "uncloseai-free", family: "UNCLOSEAI FREE", source: "FREE_CONFIRMED" },\n' +
    '  horde: { provider: "aihorde-free", family: "AI HORDE FREE", source: "FREE_CONFIRMED" }\n' +
    '};');
  write(catalogPath, catalog);
  console.log("catalog no-auth prefixes: patched");
} else {
  console.log("catalog no-auth prefixes: already applied");
}

// Server-side billing guard must agree with the catalog.
const billingPath = "src/control/chat-billing-policy.ts";
let billing = read(billingPath);
if (!billing.includes('oc: "FREE_CONFIRMED"')) {
  const anchor = '  qw: "FREE_OAUTH"\n};';
  if (!billing.includes(anchor)) throw new Error("billing no-auth prefixes: anchor not found");
  billing = billing.replace(anchor,
    '  qw: "FREE_OAUTH",\n' +
    '  oc: "FREE_CONFIRMED",\n' +
    '  ddgw: "FREE_CONFIRMED",\n' +
    '  unc: "FREE_CONFIRMED",\n' +
    '  horde: "FREE_CONFIRMED"\n' +
    '};');
  write(billingPath, billing);
  console.log("billing no-auth prefixes: patched");
} else {
  console.log("billing no-auth prefixes: already applied");
}

// The browser must honour the model selected by startup free-swarm, not a stale session.
const modelsPath = "web/control/chat-models.js";
let models = read(modelsPath);
const sourceOrderOld = 'const SOURCE_ORDER = {\n  SUBSCRIPTION_HARNESS: 0,\n  FREE_OAUTH: 1,\n  FREE_CONFIRMED: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};';
const sourceOrderNew = 'const SOURCE_ORDER = {\n  FREE_CONFIRMED: 0,\n  FREE_OAUTH: 1,\n  SUBSCRIPTION_HARNESS: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};';
if (models.includes(sourceOrderOld)) models = models.replace(sourceOrderOld, sourceOrderNew);

const preferenceOld = '    const usableIds = usable.map((entry) => entry.id);\n    const preferred = usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = await desiredSessionModel(usableIds, preferred);';
const preferenceNew = '    const usableIds = usable.map((entry) => entry.id);\n    const configuredDefault = typeof health.chatDefaultModel === "string" && usableIds.includes(health.chatDefaultModel)\n      ? health.chatDefaultModel\n      : null;\n    const preferred = configuredDefault\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = configuredDefault || await desiredSessionModel(usableIds, preferred);';
if (models.includes(preferenceOld)) models = models.replace(preferenceOld, preferenceNew);

const sortOld = '  return [...entries].sort((a, b) => {\n    const familyDelta = familyRank(a.family) - familyRank(b.family);\n    if (familyDelta) return familyDelta;\n    if (familyRank(a.family) === FAMILY_ORDER.length) {\n      const familyName = a.family.localeCompare(b.family);\n      if (familyName) return familyName;\n    }\n    const sourceDelta = (SOURCE_ORDER[a.billingSource] ?? 99) - (SOURCE_ORDER[b.billingSource] ?? 99);\n    if (sourceDelta) return sourceDelta;\n    return shortName(a).localeCompare(shortName(b));\n  });';
const sortNew = '  return [...entries].sort((a, b) => {\n    const sourceDelta = (SOURCE_ORDER[a.billingSource] ?? 99) - (SOURCE_ORDER[b.billingSource] ?? 99);\n    if (sourceDelta) return sourceDelta;\n    const familyDelta = familyRank(a.family) - familyRank(b.family);\n    if (familyDelta) return familyDelta;\n    if (familyRank(a.family) === FAMILY_ORDER.length) {\n      const familyName = a.family.localeCompare(b.family);\n      if (familyName) return familyName;\n    }\n    return shortName(a).localeCompare(shortName(b));\n  });';
if (models.includes(sortOld)) models = models.replace(sortOld, sortNew);
write(modelsPath, models);
requireMarker(modelsPath, "FREE_CONFIRMED: 0", "free-first model ordering");
requireMarker(modelsPath, "health.chatDefaultModel", "backend primary selection");
console.log("model routing UI: free-first + backend primary");

// V5 deliberately migrates away from the V3 hidden-terminal default. PTY starts visible once.
const chatPath = "web/control/chat.js";
let chat = read(chatPath);
chat = chat.replace(
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż terminal" : "Wycisz terminal";',
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Show terminal" : "Hide terminal";'
).replace(
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Hermes" : "Zamknij Hermes";',
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Show terminal" : "Hide terminal";'
);
const muteOld = 'try { state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch { state.hermesMuted = false; }';
const muteV3 = 'try { const storedHermes = localStorage.getItem(MUTE_KEY); state.hermesMuted = storedHermes === null ? true : storedHermes === "1"; } catch { state.hermesMuted = true; }';
const muteV5 = 'try {\n  const migrationKey = "koordynator.liveChat.v5TerminalVisible";\n  if (localStorage.getItem(migrationKey) !== "1") {\n    localStorage.setItem(MUTE_KEY, "0");\n    localStorage.setItem(migrationKey, "1");\n  }\n  state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1";\n} catch { state.hermesMuted = false; }';
if (chat.includes(muteOld)) chat = chat.replace(muteOld, muteV5);
else if (chat.includes(muteV3)) chat = chat.replace(muteV3, muteV5);
write(chatPath, chat);
requireMarker(chatPath, "koordynator.liveChat.v5TerminalVisible", "PTY visible migration");
console.log("PTY visibility: V5 migration installed");

// Usage display is historical consumption, not a quota balance.
const usagePath = "web/control/chat-usage.js";
let usage = read(usagePath);
usage = usage.replace(
  '`24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`',
  '`USED 24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`'
);
if (!usage.includes("These are tokens USED in the last 24 hours")) {
  usage = usage.replace(
    '      "Token totals include only provider-reported usage. No estimates are presented as facts."',
    '      "These are tokens USED in the last 24 hours, not remaining quota or token balance.",\n      "No-auth/free providers often expose rate limits rather than a remaining-token balance.",\n      "Token totals include only provider-reported usage. No estimates are presented as facts."'
  );
}
write(usagePath, usage);
console.log("usage semantics: historical consumption label installed");

// Contract checks for the completely rewritten screen.
const html = read("web/control/chat.html");
for (const id of [
  "chatFrame", "chatThread", "messageInput", "modelSelect", "sendButton", "stopButton",
  "historyButton", "newChatButton", "stageZeroButton", "hermesPane", "hermesTerm",
  "startHermesButton", "stopHermesButton", "hermesInput", "sendHermesButton",
  "githubChatButton", "githubChatConsentDialog", "primaryRouteLabel", "fallbackRoutesLabel",
  "workspaceSplitter"
]) {
  if (!html.includes(`id="${id}"`)) throw new Error(`V5_CONTRACT_MISSING_${id}`);
}
if (html.includes("control-workspace-v3") || html.includes("control-workspace-v4")) throw new Error("V5_LEGACY_WORKSPACE_REFERENCE");
requireMarker("web/control/chat-v5.css", ".v5-workspace", "V5 CSS");
requireMarker("web/control/chat-v5.js", "ensureBackendPrimary", "V5 controller");

console.log("LIVE_WORKSPACE_V5=PASS");
