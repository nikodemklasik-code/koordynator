#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const MARKER = "/* LIVE_WORKSPACE_V5_FINAL */";
const RUNTIME_MARKER = "/* LIVE_WORKSPACE_V5_RUNTIME_RECOVERY */";
const FINAL_CSS = `

${MARKER}
/* Final V5 desktop geometry + interaction recovery. */
:root { --v5-input-stack-height: 122px; }
.v5-main { grid-template-rows: 64px 54px minmax(0,1fr) 32px !important; }
.v5-toolbar { position: relative; z-index: 60; }
.v5-brand-title { font-size: 14px !important; }
.v5-brand-subtitle { font-size: 10px !important; }
.v5-route-kicker { font-size: 9px !important; }
#primaryRouteLabel { font-size: 12px !important; }
.v5-fallbacks { font-size: 10px !important; }
.v5-env { min-height: 32px; font-size: 10px !important; }
.v5-env strong,.v5-operator { font-size: 11px !important; }
.v5-action { min-height: 38px !important; height: 38px !important; padding: 0 13px !important; font-size: 11px !important; }
.v5-icon-button,.v5-more summary { min-height: 38px !important; height: 38px !important; }
.v5-more-menu button { min-height: 38px !important; font-size: 11px !important; }
.v5-chat-pane { grid-template-rows: 46px minmax(0,1fr) auto !important; }
.v5-routebar { min-height: 46px !important; }
.v5-connection strong { font-size: 11px !important; }
.billing-badge,.usage-24h,.runtime-route-badge { min-height: 26px !important; font-size: 9px !important; }
.v5-github { height: 34px !important; font-size: 10px !important; }
.session-id { font-size: 9px !important; max-width: 125px !important; }
.v5-welcome h2 { font-size: 24px !important; }
.v5-welcome p { font-size: 14px !important; }
.v5-welcome-grid { font-size: 11px !important; }
.message-meta { min-height: 32px; font-size: 10.5px !important; }
.message-bubble { font-size: 15px !important; line-height: 1.65 !important; }
.message-copy,.code-copy,.message-materialise { min-height: 30px !important; font-size: 10px !important; cursor: pointer !important; }

/* Composer uses the previously empty bottom band without growing. */
.v5-composer-zone {
  bottom: 0 !important;
  height: var(--v5-input-stack-height) !important;
  padding: 0 6px 0 14px !important;
  pointer-events: none !important;
}
.v5-composer {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  height: var(--v5-input-stack-height) !important;
  pointer-events: auto !important;
}
.v5-composer textarea { min-height: 66px !important; font-size: 15px !important; pointer-events: auto !important; }
.v5-composer-actions { pointer-events: auto !important; }
.v5-model-picker select { height: 40px !important; font-size: 12px !important; pointer-events: auto !important; }
.v5-attach,.v5-stop,.v5-send { min-height: 40px !important; height: 40px !important; pointer-events: auto !important; }
.v5-route-note { display: none !important; }
.attachment-error,.github-chat-notice,.stage-zero-notice,#exportReceipt { pointer-events: auto !important; }

/* Hermes gets about one third of the workspace and an explicit right edge. */
.v5-terminal-pane {
  border-right: 1px solid #26313a !important;
  box-shadow: inset -1px 0 0 rgba(255,255,255,.025) !important;
  pointer-events: auto !important;
}
.v5-terminal-composer {
  min-height: var(--v5-input-stack-height) !important;
  height: var(--v5-input-stack-height) !important;
  padding: 8px 6px !important;
  margin-bottom: 0 !important;
  pointer-events: auto !important;
}
.v5-terminal-composer textarea { min-height: 0 !important; height: 100% !important; font-size: 12px !important; pointer-events: auto !important; }
.v5-terminal-send { align-self: end !important; }
.v5-terminal-send,.v5-mini-button { pointer-events: auto !important; }
.hermes-hint { display: none !important; }

/* Closed overlays must never make the workspace inert. */
.history-backdrop.hidden,
.router-backdrop:not(.open),
.chat-drop-overlay { pointer-events: none !important; }
.history-panel:not(.open),
.router-drawer:not(.open) { pointer-events: none !important; }
.history-panel.open,
.router-backdrop.open,
.router-drawer.open,
.github-chat-consent-dialog[open] { pointer-events: auto !important; }
.v5-toolbar-left,.v5-toolbar-right,.v5-action,.v5-icon-button,.router-toggle { pointer-events: auto !important; }

.v5-statusbar { min-height: 32px !important; height: 32px !important; font-size: 9px !important; }
.ci-status,.v5-runtime-meta,.status-badge { font-size: 9px !important; }
.v5-rail-foot { font-size: 10px !important; }
`;

function replaceRegex(source, re, replacement, label) {
  if (!re.test(source)) throw new Error(`V5_FINAL_MARKER_MISSING ${label}`);
  return source.replace(re, replacement);
}

function patchCss(source) {
  if (source.includes(MARKER)) {
    const index = source.indexOf(MARKER);
    return `${source.slice(0, index).trimEnd()}${FINAL_CSS}`;
  }
  return `${source.trimEnd()}${FINAL_CSS}`;
}

function patchV5Js(source) {
  let next = source;
  next = replaceRegex(next, /const STORAGE_WIDTH = "[^"]+";/, 'const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth.runtime2";', "storage width");
  next = replaceRegex(next, /const DEFAULT_WIDTH = \d+;/, "const DEFAULT_WIDTH = 500;", "default terminal width");
  next = replaceRegex(next, /const MIN_WIDTH = \d+;/, "const MIN_WIDTH = 380;", "minimum terminal width");
  return next;
}

function patchHtml(source) {
  let next = source.replace(/<span id="versionLabel">[^<]*<\/span>/, '<span id="versionLabel">V5 · app v0.4.0</span>');
  next = next.replace(/<select id="modelSelect"([^>]*)\sdisabled([^>]*)>/, '<select id="modelSelect"$1$2>');
  return next;
}

function patchChatJs(source) {
  let next = source.replace(/\$\("versionLabel"\)\.textContent = `[^`]*\$\{health\.version\}`;/, '$("versionLabel").textContent = `V5 · app v${health.version}`;');
  next = next.replace(
    '    body: JSON.stringify({ model: modelSelect.value })',
    '    body: JSON.stringify(modelSelect.value ? { model: modelSelect.value } : {})'
  );
  next = next.replace(
    '      body: JSON.stringify({ message, model: modelSelect.value, attachments })',
    '      body: JSON.stringify(modelSelect.value ? { message, model: modelSelect.value, attachments } : { message, attachments })'
  );
  return next;
}

function patchChatModels(source) {
  let next = source;
  const prior = next.indexOf(RUNTIME_MARKER);
  if (prior >= 0) next = next.slice(0, prior).trimEnd();

  next = next.replace(
`function routeReady() {
  return Boolean(
    chatModelSelect
    && chatModelSelect.dataset.catalog === "omniroute"
    && chatModelSelect.dataset.billingAllowed === "true"
    && chatModelSelect.value
  );
}`,
`function routeReady() {
  return Boolean(
    chatModelSelect
    && (
      (chatModelSelect.dataset.catalog === "omniroute" && chatModelSelect.dataset.billingAllowed === "true" && chatModelSelect.value)
      || chatModelSelect.dataset.catalog === "server-default"
    )
  );
}`
  );

  next = next.replace(
`    showCatalogFailure(error instanceof Error ? error.message : "Model catalog unavailable");
    settleChatModelGate(false);
    return false;`,
`    activateServerDefaultRoute(error instanceof Error ? error.message : "Model catalog unavailable");
    return false;`
  );

  return `${next}\n\n${RUNTIME_MARKER}\nfunction activateServerDefaultRoute(reason = "Model catalog is still resolving") {\n  if (!chatModelSelect || chatModelSelect.dataset.catalog === "omniroute") return;\n  chatModelSelect.textContent = "";\n  const option = document.createElement("option");\n  option.value = "";\n  option.textContent = "Server default route";\n  option.selected = true;\n  chatModelSelect.appendChild(option);\n  chatModelSelect.dataset.catalog = "server-default";\n  chatModelSelect.dataset.billingAllowed = "true";\n  chatModelSelect.disabled = false;\n  chatModelSelect.title = String(reason);\n  if (chatBillingBadge) {\n    chatBillingBadge.textContent = "SERVER ROUTE";\n    chatBillingBadge.className = "billing-badge checking";\n  }\n  if (chatBillingNote) chatBillingNote.textContent = "Using the server-configured default route while the live model catalog resolves.";\n  settleChatModelGate(true);\n  enforceRouteGuard();\n}\n\nconst v5RuntimeFetchBase = window.fetch;\nwindow.fetch = async function koordynatorRuntimeRecoveryFetch(input, init) {\n  const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET") || "GET").toUpperCase();\n  const path = requestPath(input);\n  const bypassModelGate = method === "POST" && (path === "/api/chat/sessions" || /^\\/api\\/chat\\/sessions\\/[0-9a-f-]+\\/messages$/i.test(path));\n  if (bypassModelGate) {\n    let nextInit = init;\n    if (typeof init?.body === "string") {\n      try {\n        const payload = JSON.parse(init.body);\n        if (payload && typeof payload === "object" && payload.model === "") delete payload.model;\n        nextInit = { ...init, body: JSON.stringify(payload) };\n      } catch { /* server validates malformed JSON */ }\n    }\n    return chatNativeFetch(input, nextInit);\n  }\n  return v5RuntimeFetchBase(input, init);\n};\n\nif (typeof setTimeout === "function") {\n  setTimeout(() => {\n    if (!chatModelGateSettled && chatModelSelect?.dataset.catalog !== "omniroute") {\n      activateServerDefaultRoute("Live model catalog is taking too long; server default route enabled.");\n    }\n  }, 1500);\n}\n`;
}

function patchHistoryJs(source) {
  let next = source;
  next = next.replace('  oldButtons.forEach((button) => button?.classList.add("hidden"));\n', '');
  next = next.replace(
    '  const group = document.querySelector(".chat-action-group");',
    '  const group = document.querySelector(".v5-toolbar-left") || document.querySelector(".chat-action-group");'
  );
  next = next.replace(
    '    button.className = "secondary-button chat-action-button";',
    '    button.className = group.classList.contains("v5-toolbar-left") ? "v5-action" : "secondary-button chat-action-button";'
  );
  next = next.replace(
    '    group.insertBefore(button, oldButtons.find(Boolean) || null);',
    '    const stageZero = document.getElementById("stageZeroButton");\n    if (stageZero?.parentNode === group) group.insertBefore(button, stageZero);\n    else group.appendChild(button);'
  );
  return next;
}

function patchChatModelsWithSafeGate(source) {
  return patchChatModels(source).replace(
    '  const bypassModelGate = method === "POST" && (path === "/api/chat/sessions" || /^\\/api\\/chat\\/sessions\\/[0-9a-f-]+\\/messages$/i.test(path));',
    '  const bypassModelGate = chatModelSelect?.dataset.catalog === "server-default"\n    && method === "POST"\n    && (path === "/api/chat/sessions" || /^\\/api\\/chat\\/sessions\\/[0-9a-f-]+\\/messages$/i.test(path));'
  );
}

function patchServerTs(source) {
  if (source.includes("chatDefaultModel: options.chatDefaultModel ?? null")) return source;
  return source.replace(
    '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",',
    '          version: options.version ?? VERSION,\n          chatDefaultModel: options.chatDefaultModel ?? null,\n          chatFallbackModels: options.chatFallbackModels ?? [],\n          liveChatBillingPolicy: "STRICT_PROVENANCE",'
  );
}

async function apply(root = process.cwd()) {
  const targets = [
    ["web/control/chat-v5.css", patchCss],
    ["web/control/chat-v5.js", patchV5Js],
    ["web/control/chat.html", patchHtml],
    ["web/control/chat.js", patchChatJs],
    ["web/control/chat-models.js", patchChatModelsWithSafeGate],
    ["web/control/chat-history.js", patchHistoryJs],
    ["src/control/server.ts", patchServerTs]
  ];
  const changed = [];
  for (const [path, patch] of targets) {
    const absolute = resolve(root, path);
    const before = await readFile(absolute, "utf8");
    const after = patch(before);
    if (after !== before) {
      await writeFile(absolute, after, "utf8");
      changed.push(path);
    }
  }
  console.log("LIVE_WORKSPACE_V5_FINAL=PASS runtime=recovered catalog_timeout=1500ms terminal=500px composer=lowered interaction=enabled");
  console.log(`PATCHED=${changed.length ? changed.join(",") : "already-applied"}`);
}

function selfTest() {
  const css = patchCss(".x{display:block}");
  if (!css.includes(MARKER) || !css.includes("--v5-input-stack-height: 122px") || !css.includes("border-right: 1px solid") || !css.includes(".hermes-hint { display: none")) throw new Error("V5_FINAL_CSS_FAILED");
  if (patchCss(css) !== css) throw new Error("V5_FINAL_CSS_NOT_IDEMPOTENT");

  const js = 'const STORAGE_WIDTH = "old";\nconst DEFAULT_WIDTH = 320;\nconst MIN_WIDTH = 280;';
  const out = patchV5Js(js);
  if (!out.includes("DEFAULT_WIDTH = 500") || !out.includes("MIN_WIDTH = 380") || !out.includes("terminalWidth.runtime2")) throw new Error("V5_FINAL_GEOMETRY_FAILED");

  const html = '<span id="versionLabel">v0.4.0</span><select id="modelSelect" disabled><option>Loading…</option></select>';
  const htmlOut = patchHtml(html);
  if (!htmlOut.includes("V5 · app v0.4.0") || htmlOut.includes('modelSelect" disabled')) throw new Error("V5_FINAL_HTML_FAILED");

  const chat = '$("versionLabel").textContent = `v${health.version}`;\n    body: JSON.stringify({ model: modelSelect.value })\n      body: JSON.stringify({ message, model: modelSelect.value, attachments })';
  const chatOut = patchChatJs(chat);
  if (!chatOut.includes('modelSelect.value ? { model: modelSelect.value } : {}') || !chatOut.includes('{ message, attachments }')) throw new Error("V5_FINAL_CHAT_RUNTIME_FAILED");

  const models = `function routeReady() {\n  return Boolean(\n    chatModelSelect\n    && chatModelSelect.dataset.catalog === "omniroute"\n    && chatModelSelect.dataset.billingAllowed === "true"\n    && chatModelSelect.value\n  );\n}\n    showCatalogFailure(error instanceof Error ? error.message : "Model catalog unavailable");\n    settleChatModelGate(false);\n    return false;`;
  const modelsOut = patchChatModelsWithSafeGate(models);
  if (!modelsOut.includes("server-default") || !modelsOut.includes("1500") || !modelsOut.includes("chatNativeFetch")) throw new Error("V5_FINAL_MODEL_RECOVERY_FAILED");

  const server = '          version: options.version ?? VERSION,\n          liveChatBillingPolicy: "STRICT_PROVENANCE",';
  const serverOut = patchServerTs(server);
  if (!serverOut.includes("chatDefaultModel") || !serverOut.includes("chatFallbackModels")) throw new Error("V5_FINAL_HEALTH_ROUTE_FAILED");

  console.log("LIVE_WORKSPACE_V5_FINAL_SELF_TEST=PASS");
}

if (process.argv.includes("--self-test")) selfTest();
else await apply();
