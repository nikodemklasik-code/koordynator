#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const htmlPath = resolve(root, "web/control/chat.html");
const serverPath = resolve(root, "src/control/server.ts");

async function patchFile(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
  return after;
}

export function patchChatHtml(source) {
  let out = source;
  if (!out.includes('href="/chat-router.css')) {
    const marker = '<link rel="stylesheet" href="/chat-v5.css?v=5" />';
    if (!out.includes(marker)) throw new Error("ROUTER_INSTALL_CHAT_CSS_MARKER_MISSING");
    out = out.replace(marker, `${marker}\n  <link rel="stylesheet" href="/chat-router.css?v=1" />`);
  }
  if (!out.includes('src="/chat-router.js')) {
    const marker = '<script src="/chat-v5.js?v=5" defer></script>';
    if (!out.includes(marker)) throw new Error("ROUTER_INSTALL_CHAT_JS_MARKER_MISSING");
    out = out.replace(marker, `${marker}\n  <script src="/chat-router.js?v=1" defer></script>`);
  }
  return out;
}

export function patchServer(source) {
  let out = source;
  const cssMarker = '        "/chat-usage.css": { name: "chat-usage.css", type: "text/css; charset=utf-8" },';
  const jsMarker = '        "/chat-usage.js": { name: "chat-usage.js", type: "text/javascript; charset=utf-8" },';
  if (!out.includes(cssMarker) || !out.includes(jsMarker)) throw new Error("ROUTER_INSTALL_STATIC_MAP_MARKER_MISSING");

  const cssRoutes = [
    '        "/chat-v5.css": { name: "chat-v5.css", type: "text/css; charset=utf-8" },',
    '        "/chat-router.css": { name: "chat-router.css", type: "text/css; charset=utf-8" },'
  ];
  const jsRoutes = [
    '        "/chat-v5.js": { name: "chat-v5.js", type: "text/javascript; charset=utf-8" },',
    '        "/chat-router.js": { name: "chat-router.js", type: "text/javascript; charset=utf-8" },'
  ];

  const missingCss = cssRoutes.filter((line) => !out.includes(line));
  if (missingCss.length) out = out.replace(cssMarker, `${cssMarker}\n${missingCss.join("\n")}`);
  const missingJs = jsRoutes.filter((line) => !out.includes(line));
  if (missingJs.length) out = out.replace(jsMarker, `${jsMarker}\n${missingJs.join("\n")}`);
  return out;
}

export async function installRouterInspector() {
  const html = await patchFile(htmlPath, patchChatHtml);
  const server = await patchFile(serverPath, patchServer);
  const checks = [
    ["HTML_CSS", html.includes('/chat-router.css?v=1')],
    ["HTML_JS", html.includes('/chat-router.js?v=1')],
    ["SERVER_CSS", server.includes('"/chat-router.css"')],
    ["SERVER_JS", server.includes('"/chat-router.js"')],
    ["SERVER_V5_CSS", server.includes('"/chat-v5.css"')],
    ["SERVER_V5_JS", server.includes('"/chat-v5.js"')]
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${name}=${ok ? "PASS" : "FAIL"}`);
  if (failed.length) throw new Error(`ROUTER_INSPECTOR_INSTALL_FAILED:${failed.map(([name]) => name).join(",")}`);
  console.log("COORDINATOR_ROUTER_INSPECTOR=PASS");
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invoked) installRouterInspector().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
