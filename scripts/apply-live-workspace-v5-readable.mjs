#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const CSS_MARKER = "/* LIVE_WORKSPACE_V5_READABLE_SCALE */";
const READABLE_CSS = `

${CSS_MARKER}
/* Desktop-readable scale. Preserve layout, increase legibility and click targets. */
.v5-rail-foot { font-size: 10px !important; }
.v5-main { grid-template-rows: 64px 54px minmax(0, 1fr) 32px !important; }
.v5-brand-title { font-size: 14px !important; }
.v5-brand-subtitle { font-size: 10px !important; }
.v5-route-kicker { font-size: 9px !important; }
#primaryRouteLabel { font-size: 12px !important; }
.v5-fallbacks { font-size: 10px !important; }
.v5-env { min-height: 32px; padding: 6px 11px !important; font-size: 10px !important; }
.v5-env strong, .v5-operator { font-size: 11px !important; }
.v5-toolbar-left, .v5-toolbar-right { gap: 8px !important; }
.v5-action { min-height: 38px !important; height: 38px !important; padding: 0 13px !important; font-size: 11px !important; }
.v5-icon-button { width: 40px !important; height: 38px !important; font-size: 17px !important; }
.v5-more summary { width: 42px !important; height: 38px !important; font-size: 14px !important; }
.v5-more-menu { top: 44px !important; width: 190px !important; }
.v5-more-menu button { min-height: 38px !important; height: 38px !important; font-size: 11px !important; }
.v5-chat-pane { grid-template-rows: 46px minmax(0, 1fr) auto !important; }
.v5-routebar { min-height: 46px !important; gap: 9px !important; }
.v5-connection strong { font-size: 11px !important; }
.chat-status-dot { width: 8px !important; height: 8px !important; }
.billing-badge, .usage-24h, .runtime-route-badge { min-height: 26px !important; padding: 4px 9px !important; font-size: 9px !important; }
.v5-github { height: 34px !important; padding: 0 10px !important; font-size: 10px !important; }
.v5-github-mark { font-size: 9px !important; }
.session-id { max-width: 125px !important; flex-basis: 125px !important; font-size: 9px !important; }
.v5-welcome { width: min(820px, calc(100% - 56px)) !important; }
.v5-welcome h2 { font-size: 24px !important; }
.v5-welcome p { font-size: 14px !important; }
.v5-welcome-grid { font-size: 11px !important; gap: 10px 22px !important; }
.chat-message { width: min(920px, calc(100% - 54px)) !important; }
.message-meta { min-height: 32px; gap: 7px !important; font-size: 10.5px !important; }
.message-model { padding: 4px 9px !important; }
.message-bubble { font-size: 15px !important; line-height: 1.65 !important; }
.message-copy, .code-copy, .message-materialise { min-height: 30px !important; padding: 0 9px !important; font-size: 10px !important; cursor: pointer !important; }
.v5-composer { width: min(920px, 100%) !important; }
.v5-composer textarea { min-height: 66px !important; padding: 16px 17px 8px !important; font-size: 15px !important; }
.v5-composer-actions { padding: 5px 9px 9px !important; gap: 8px !important; }
.v5-model-picker { min-width: 260px !important; max-width: 650px !important; }
.v5-model-picker select { height: 40px !important; padding: 0 34px 0 12px !important; font-size: 12px !important; }
.v5-attach, .v5-stop, .v5-send { min-height: 40px !important; height: 40px !important; }
.v5-attach { width: 40px !important; font-size: 18px !important; }
.v5-send { width: 42px !important; font-size: 18px !important; }
.v5-route-note { width: min(920px, 100%) !important; font-size: 9.5px !important; }
.v5-terminal-pane { grid-template-rows: 50px minmax(0, 1fr) auto auto !important; }
.v5-terminal-head { min-height: 50px !important; padding: 0 12px !important; }
.v5-terminal-title strong { font-size: 12px !important; }
.v5-terminal-title small { font-size: 9px !important; }
.hermes-state { padding: 4px 8px !important; font-size: 9px !important; }
.v5-mini-button { min-height: 34px !important; height: 34px !important; padding: 0 10px !important; font-size: 10px !important; }
.v5-terminal-composer { grid-template-columns: minmax(0, 1fr) 42px !important; gap: 8px !important; padding: 9px !important; }
.v5-terminal-composer textarea { min-height: 44px !important; padding: 11px 12px !important; font-size: 12px !important; }
.v5-terminal-send { width: 42px !important; height: 44px !important; font-size: 18px !important; }
.hermes-hint { font-size: 10px !important; }
.v5-statusbar { min-height: 32px !important; height: 32px !important; font-size: 9px !important; }
.ci-status, .v5-runtime-meta, .status-badge { font-size: 9px !important; }
.status-ring { width: 21px !important; height: 21px !important; }
.history-panel { width: min(440px, 94vw) !important; }
.history-item { min-height: 58px !important; }
.history-item-title { font-size: 13px !important; }
.history-item-meta, .history-empty { font-size: 10.5px !important; }
.github-chat-consent-dialog { font-size: 13px !important; }
.github-chat-consent-dialog button { min-height: 38px; font-size: 11px; }
.router-toggle { min-height: 38px !important; font-size: 11px !important; }
.router-kicker, .router-label, .router-live { font-size: 9px !important; }
.router-title-row h2 { font-size: 18px !important; }
.router-action { min-height: 36px !important; height: 36px !important; font-size: 10px !important; }
.router-request { font-size: 14px !important; }
.router-chip { font-size: 10px !important; padding: 5px 8px !important; }
.router-signal { font-size: 11px !important; padding: 9px 10px !important; }
.router-signal strong, .router-agent strong { font-size: 10px !important; }
.router-agent span { font-size: 9px !important; }
.router-event { font-size: 10px !important; }
.router-disclaimer { font-size: 10px !important; }

@media (max-width: 900px) {
  .v5-main { grid-template-rows: 60px 52px minmax(0, 1fr) 30px !important; }
  .v5-action { min-height: 36px !important; height: 36px !important; padding: 0 10px !important; }
}
`;

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`V5_READABLE_PATCH_MARKER_MISSING ${label}`);
  return source.replace(from, to);
}

export function patchReadableCss(source) {
  return source.includes(CSS_MARKER) ? source : `${source.trimEnd()}${READABLE_CSS}`;
}

export function patchChatHtml(source) {
  return replaceOnce(source, '<span id="versionLabel">v0.4.0</span>', '<span id="versionLabel">V5 · app v0.4.0</span>', "chat.html versionLabel");
}

export function patchChatJs(source) {
  return replaceOnce(source, '$("versionLabel").textContent = `v${health.version}`;', '$("versionLabel").textContent = `V5 · app v${health.version}`;', "chat.js versionLabel");
}

export function patchV5Js(source) {
  const replacements = [
    ['.v5-model-search{width:170px;height:34px;', '.v5-model-search{width:190px;height:40px;'],
    ['color:#d9e2e8;font-size:10px;', 'color:#d9e2e8;font-size:12px;'],
    ['.v5-model-role{height:34px;', '.v5-model-role{height:40px;'],
    ['color:#9fb0bb;font-size:9px;', 'color:#9fb0bb;font-size:11px;'],
    ['bottom:40px;', 'bottom:46px;'],
    ['font:600 10px/1.25', 'font:600 12px/1.3'],
    ['color:#687986;font-size:8px', 'color:#687986;font-size:10px'],
    ['font-size:6px;letter-spacing:.04em', 'font-size:8px;letter-spacing:.04em'],
    ['font-size:9px;text-align:center', 'font-size:11px;text-align:center']
  ];
  let next = source;
  for (const [from, to] of replacements) next = replaceOnce(next, from, to, `chat-v5.js ${from}`);
  return next;
}

async function patchRepository(root = process.cwd()) {
  const targets = [
    ["web/control/chat-v5.css", patchReadableCss],
    ["web/control/chat.html", patchChatHtml],
    ["web/control/chat.js", patchChatJs],
    ["web/control/chat-v5.js", patchV5Js]
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
  console.log("LIVE_WORKSPACE_V5_READABLE=PASS ui=V5 min_actions=38px message=15px composer=15px");
  console.log(`PATCHED=${changed.length ? changed.join(",") : "already-applied"}`);
}

function selfTest() {
  const css = patchReadableCss(".v5-action { height: 30px; }");
  if (!css.includes(CSS_MARKER) || !css.includes("min-height: 38px")) throw new Error("V5_READABLE_CSS_SELF_TEST_FAILED");
  if (patchReadableCss(css) !== css) throw new Error("V5_READABLE_CSS_NOT_IDEMPOTENT");

  const html = '<span id="versionLabel">v0.4.0</span>';
  const htmlPatched = patchChatHtml(html);
  if (!htmlPatched.includes("V5 · app v0.4.0") || patchChatHtml(htmlPatched) !== htmlPatched) throw new Error("V5_READABLE_HTML_SELF_TEST_FAILED");

  const js = '$("versionLabel").textContent = `v${health.version}`;';
  const jsPatched = patchChatJs(js);
  if (!jsPatched.includes("V5 · app v${health.version}") || patchChatJs(jsPatched) !== jsPatched) throw new Error("V5_READABLE_CHAT_JS_SELF_TEST_FAILED");

  const v5js = '.v5-model-search{width:170px;height:34px;color:#d9e2e8;font-size:10px;.v5-model-role{height:34px;color:#9fb0bb;font-size:9px;bottom:40px;font:600 10px/1.25;color:#687986;font-size:8px;font-size:6px;letter-spacing:.04em;font-size:9px;text-align:center';
  const v5Patched = patchV5Js(v5js);
  if (!v5Patched.includes("height:40px") || !v5Patched.includes("font-size:12px")) throw new Error("V5_READABLE_V5_JS_SELF_TEST_FAILED");
  console.log("LIVE_WORKSPACE_V5_READABLE_SELF_TEST=PASS");
}

if (process.argv.includes("--self-test")) selfTest();
else await patchRepository();
