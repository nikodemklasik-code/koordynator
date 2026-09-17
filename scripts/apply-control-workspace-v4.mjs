#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BRANCH = "origin/fix/local-control-ui-redesign";
const read = (path) => readFileSync(path, "utf8");
const write = (path, value) => writeFileSync(path, value, "utf8");
const asset = (path) => execFileSync("git", ["show", `${BRANCH}:${path}`], { encoding: "utf8" });

function replace(path, from, to, label) {
  let source = read(path);
  if (source.includes(to)) { console.log(`${label}: already applied`); return; }
  if (!source.includes(from)) throw new Error(`${label}: expected block not found`);
  write(path, source.replace(from, to));
  console.log(`${label}: patched`);
}

write("web/control/control-workspace-v4.css", asset("web/control/control-workspace-v4.css"));
write("web/control/control-workspace-v4.js", asset("web/control/control-workspace-v4.js"));
console.log("workspace v4 assets: installed");

// Backend health is the source of truth for the live-probed primary/fallback chain.
replace(
  "src/control/server.ts",
  '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  '          version: options.version ?? VERSION,\n          chatDefaultModel: options.chatDefaultModel ?? null,\n          chatFallbackModels: options.chatFallbackModels ?? [],\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
  "health primary/fallbacks"
);

// Server billing guard must recognise the no-auth swarm prefixes as confirmed free.
const billingPath = "src/control/chat-billing-policy.ts";
let billing = read(billingPath);
if (!billing.includes('  oc: "FREE_CONFIRMED"')) {
  billing = billing.replace(
    'const PROTECTED_PREFIX_SOURCE: Record<string, ChatModelBillingSource> = {\n',
    'const PROTECTED_PREFIX_SOURCE: Record<string, ChatModelBillingSource> = {\n  oc: "FREE_CONFIRMED",\n  ddgw: "FREE_CONFIRMED",\n  unc: "FREE_CONFIRMED",\n  horde: "FREE_CONFIRMED",\n'
  );
  write(billingPath, billing);
  console.log("server free-prefix billing: patched");
} else console.log("server free-prefix billing: already applied");

// Browser catalog must classify those same live catalog routes as FREE_CONFIRMED.
const modelsPath = "web/control/chat-models.js";
let models = read(modelsPath);
if (!models.includes('const NOAUTH_FREE_PREFIXES = new Set(["oc", "ddgw", "unc", "horde"]);')) {
  models = models.replace(
    'function sourceFor(modelId) {\n  const explicit = catalogBilling?.modelSources?.[modelId];\n  if (knownSource(explicit)) return explicit;\n  return freeLike(modelId) ? "FREE_REQUESTED" : "UNKNOWN";\n}',
    'const NOAUTH_FREE_PREFIXES = new Set(["oc", "ddgw", "unc", "horde"]);\n\nfunction sourceFor(modelId) {\n  const explicit = catalogBilling?.modelSources?.[modelId];\n  if (knownSource(explicit) && explicit !== "UNKNOWN") return explicit;\n  const prefix = String(modelId || "").split("/", 1)[0].toLowerCase();\n  if (NOAUTH_FREE_PREFIXES.has(prefix)) return "FREE_CONFIRMED";\n  return freeLike(modelId) ? "FREE_REQUESTED" : "UNKNOWN";\n}'
  );
  console.log("browser free-prefix billing: patched");
}

models = models.replace(
  'const SOURCE_ORDER = {\n  SUBSCRIPTION_HARNESS: 0,\n  FREE_OAUTH: 1,\n  FREE_CONFIRMED: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};',
  'const SOURCE_ORDER = {\n  FREE_CONFIRMED: 0,\n  FREE_OAUTH: 1,\n  SUBSCRIPTION_HARNESS: 2,\n  FREE_REQUESTED: 3,\n  PAID_API: 4,\n  UNKNOWN: 5\n};'
);
const oldPreference = '    const usableIds = usable.map((entry) => entry.id);\n    const preferred = usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = await desiredSessionModel(usableIds, preferred);';
const newPreference = '    const usableIds = usable.map((entry) => entry.id);\n    const configuredDefault = typeof health.chatDefaultModel === "string" && usableIds.includes(health.chatDefaultModel)\n      ? health.chatDefaultModel\n      : null;\n    const preferred = configuredDefault\n      || usable.find((entry) => entry.billingSource === "FREE_CONFIRMED")?.id\n      || usable.find((entry) => entry.billingSource === "FREE_OAUTH")?.id\n      || usable.find((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS")?.id\n      || (usableIds.includes(previous) ? previous : usableIds[0]);\n    const desired = configuredDefault || await desiredSessionModel(usableIds, preferred);';
if (models.includes(oldPreference)) models = models.replace(oldPreference, newPreference);
write(modelsPath, models);
console.log("model picker free-primary authority: patched");

// PTY is visible by default in v4, but remains collapsible from the Hermes button.
const chatPath = "web/control/chat.js";
let chat = read(chatPath);
chat = chat.replace(
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Hermes" : "Zamknij Hermes";',
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż Hermes" : "Ukryj Hermes";'
).replace(
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż terminal" : "Wycisz terminal";',
  'if (muteHermesButton) muteHermesButton.textContent = state.hermesMuted ? "Pokaż Hermes" : "Ukryj Hermes";'
);
const v3Mute = 'try { const storedHermes = localStorage.getItem(MUTE_KEY); state.hermesMuted = storedHermes === null ? true : storedHermes === "1"; } catch { state.hermesMuted = true; }';
const originalMute = 'try { state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch { state.hermesMuted = false; }';
const v4Mute = 'try { const layoutKey = "koordynator.liveChat.layoutVersion"; if (localStorage.getItem(layoutKey) !== "v4") { localStorage.setItem(MUTE_KEY, "0"); localStorage.setItem(layoutKey, "v4"); } state.hermesMuted = localStorage.getItem(MUTE_KEY) === "1"; } catch { state.hermesMuted = false; }';
if (chat.includes(v3Mute)) chat = chat.replace(v3Mute, v4Mute);
else if (chat.includes(originalMute)) chat = chat.replace(originalMute, v4Mute);
write(chatPath, chat);
console.log("Hermes PTY default visible: patched");

// Usage is usage, not quota balance.
const usagePath = "web/control/chat-usage.js";
let usage = read(usagePath);
usage = usage.replace(
  '`24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`',
  '`USED 24H · FREE/OAUTH ${compactNumber(freeTokens)} · SUBSCRIPTION ${compactNumber(harnessTokens)} · PAYG ${compactNumber(paidTokens)} · UNKNOWN ${unknownRequests} · UNREPORTED ${unreported}`'
);
write(usagePath, usage);

// Load v4 last, after every legacy/inline stylesheet and script.
const htmlPath = "web/control/chat.html";
let html = read(htmlPath);
if (!html.includes("/control-workspace-v4.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/control-workspace-v4.css?v=4" />\n</head>');
if (!html.includes("/control-workspace-v4.js")) html = html.replace("</body>", '  <script src="/control-workspace-v4.js?v=4" defer></script>\n</body>');
write(htmlPath, html);
console.log("workspace v4 hooks: installed");

const checks = [
  ["web/control/chat.html", "control-workspace-v4.css?v=4"],
  ["web/control/chat.html", "control-workspace-v4.js?v=4"],
  ["src/control/chat-billing-policy.ts", 'oc: "FREE_CONFIRMED"'],
  ["web/control/chat-models.js", "NOAUTH_FREE_PREFIXES"],
  ["web/control/chat-models.js", "health.chatDefaultModel"],
  ["web/control/chat.js", 'layoutKey = "koordynator.liveChat.layoutVersion"'],
  ["src/control/server.ts", "chatDefaultModel: options.chatDefaultModel"]
];
for (const [path, marker] of checks) if (!read(path).includes(marker)) throw new Error(`VERIFY_FAIL ${path} missing ${marker}`);
console.log("CONTROL_WORKSPACE_V4=PASS");
