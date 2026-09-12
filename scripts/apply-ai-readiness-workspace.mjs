#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BRANCH = "origin/redesign/live-chat-v5";

function read(path) { return readFileSync(path, "utf8"); }
function write(path, value) { writeFileSync(path, value, "utf8"); }
function asset(path) { return execFileSync("git", ["show", `${BRANCH}:${path}`], { encoding: "utf8" }); }
function required(value, message) { if (!value) throw new Error(message); }

function install(path) {
  write(path, asset(path));
  console.log(`${path}: installed`);
}

for (const path of [
  "src/control/omniroute-live-status.ts",
  "src/control/worker-agents.ts",
  "src/control/provider-autoconnect.ts",
  "src/control/materialisation-readiness.ts",
  "scripts/ai-connect-existing.mjs",
  "web/control/chat-v5.js",
  "web/control/releases.html",
  "web/control/releases.js",
  "web/control/releases.css"
]) install(path);

const packagePath = "package.json";
const pkg = JSON.parse(read(packagePath));
pkg.scripts = pkg.scripts || {};
pkg.scripts["ai:connect-existing"] = "node scripts/ai-connect-existing.mjs";
write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("package.json: ai:connect-existing installed");

const serverPath = "src/control/server.ts";
let server = read(serverPath);

if (!server.includes('from "./provider-autoconnect.js"')) {
  const anchor = 'import { OmniRouteLiveStatusService } from "./omniroute-live-status.js";';
  required(server.includes(anchor), "SERVER_IMPORT_ANCHOR_MISSING");
  server = server.replace(anchor, `${anchor}\nimport { ProviderAutoconnectError, ProviderAutoconnectService } from "./provider-autoconnect.js";\nimport { buildMaterialisationReadiness } from "./materialisation-readiness.js";`);
  console.log("server: readiness imports patched");
}

if (!server.includes('    pathname === "/api/providers/connect-existing" ||')) {
  const anchor = '    pathname === "/api/integrations/hermes-grants" ||';
  required(server.includes(anchor), "SERVER_POST_ANCHOR_MISSING");
  server = server.replace(anchor, `${anchor}\n    pathname === "/api/providers/connect-existing" ||`);
  console.log("server: bulk-connect POST allowlist patched");
}

if (!server.includes("const providerAutoconnect = new ProviderAutoconnectService(projectRoot);")) {
  const anchor = "  const repositories = new RepositoryRegistry(stateDir);";
  required(server.includes(anchor), "SERVER_AUTOCONNECT_INIT_ANCHOR_MISSING");
  server = server.replace(anchor, `${anchor}\n  const providerAutoconnect = new ProviderAutoconnectService(projectRoot);`);
  console.log("server: provider autoconnect service patched");
}

if (!server.includes("materialisationEnabled: materialisation !== null")) {
  const healthAnchor = "          version: options.version ?? VERSION,";
  required(server.includes(healthAnchor), "SERVER_HEALTH_ANCHOR_MISSING");
  const additions = [healthAnchor];
  if (!server.includes("chatDefaultModel: options.chatDefaultModel")) additions.push("          chatDefaultModel: options.chatDefaultModel ?? null,");
  if (!server.includes("chatFallbackModels: options.chatFallbackModels")) additions.push("          chatFallbackModels: options.chatFallbackModels ?? [],");
  additions.push("          materialisationEnabled: materialisation !== null,");
  server = server.replace(healthAnchor, additions.join("\n"));
  console.log("server: health truth patched");
}

if (!server.includes('url.pathname === "/api/readiness/materialisation"')) {
  const anchor = '      if (url.pathname === "/api/releases") return sendJson(response, 200, await releases.list());';
  required(server.includes(anchor), "SERVER_READINESS_ROUTE_ANCHOR_MISSING");
  const route = `      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/readiness/materialisation") {\n        const force = url.searchParams.get("refresh") === "1";\n        return sendJson(response, 200, await buildMaterialisationReadiness({\n          projectRoot,\n          materialisationEnabled: materialisation !== null,\n          ...(options.chatDefaultModel === undefined ? {} : { primaryModel: options.chatDefaultModel }),\n          ...(options.chatFallbackModels === undefined ? {} : { fallbackModels: options.chatFallbackModels }),\n          routes: await omniLive.list(force),\n          hermesGrant: await hermesGrants.status()\n        }));\n      }\n\n`;
  server = server.replace(anchor, route + anchor);
  console.log("server: materialisation readiness endpoint patched");
}

if (!server.includes('method === "POST" && url.pathname === "/api/providers/connect-existing"')) {
  const anchor = '      if (url.pathname === "/api/providers") {';
  required(server.includes(anchor), "SERVER_BULK_CONNECT_ROUTE_ANCHOR_MISSING");
  const route = `      if (method === "POST" && url.pathname === "/api/providers/connect-existing") {\n        const payload = await readJsonBody(request, 1024);\n        assertExactKeys(payload, ["approved"]);\n        const result = await providerAutoconnect.connectExisting(payload.approved === true);\n        return sendJson(response, 200, { ...result, omniRoutes: await omniLive.list(true) });\n      }\n`;
  server = server.replace(anchor, route + anchor);
  console.log("server: provider bulk-connect endpoint patched");
}

if (!server.includes("error instanceof ProviderAutoconnectError")) {
  const anchor = "error instanceof ChatServiceError ||";
  required(server.includes(anchor), "SERVER_ERROR_ANCHOR_MISSING");
  server = server.replace(anchor, `error instanceof ProviderAutoconnectError || ${anchor}`);
  console.log("server: provider autoconnect error mapping patched");
}

if (!server.includes('"/chat-v5.css"')) {
  const anchor = '        "/chat.css": { name: "chat.css", type: "text/css; charset=utf-8" },';
  required(server.includes(anchor), "SERVER_V5_CSS_ANCHOR_MISSING");
  server = server.replace(anchor, `${anchor}\n        "/chat-v5.css": { name: "chat-v5.css", type: "text/css; charset=utf-8" },`);
}
if (!server.includes('"/chat-v5.js"')) {
  const anchor = '        "/chat.js": { name: "chat.js", type: "text/javascript; charset=utf-8" },';
  required(server.includes(anchor), "SERVER_V5_JS_ANCHOR_MISSING");
  server = server.replace(anchor, `${anchor}\n        "/chat-v5.js": { name: "chat-v5.js", type: "text/javascript; charset=utf-8" },`);
}

write(serverPath, server);
for (const marker of [
  'url.pathname === "/api/readiness/materialisation"',
  'method === "POST" && url.pathname === "/api/providers/connect-existing"',
  "materialisationEnabled: materialisation !== null",
  '"/chat-v5.css"',
  '"/chat-v5.js"'
]) required(read(serverPath).includes(marker), `AI_READINESS_CONTRACT_MISSING:${marker}`);

console.log("AI_READINESS_WORKSPACE=PASS");
