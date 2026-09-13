#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/control/server.ts";
let source = readFileSync(path, "utf8");

const cssAnchor = '        "/chat-usage.css": { name: "chat-usage.css", type: "text/css; charset=utf-8" },';
const cssRoute = '        "/chat-v5.css": { name: "chat-v5.css", type: "text/css; charset=utf-8" },';
const jsAnchor = '        "/chat-usage.js": { name: "chat-usage.js", type: "text/javascript; charset=utf-8" },';
const jsRoute = '        "/chat-v5.js": { name: "chat-v5.js", type: "text/javascript; charset=utf-8" },';

if (!source.includes(cssRoute)) {
  if (!source.includes(cssAnchor)) throw new Error("V5_STATIC_CSS_ANCHOR_MISSING");
  source = source.replace(cssAnchor, `${cssAnchor}\n${cssRoute}`);
}

if (!source.includes(jsRoute)) {
  if (!source.includes(jsAnchor)) throw new Error("V5_STATIC_JS_ANCHOR_MISSING");
  source = source.replace(jsAnchor, `${jsAnchor}\n${jsRoute}`);
}

writeFileSync(path, source, "utf8");

if (!source.includes(cssRoute) || !source.includes(jsRoute)) throw new Error("V5_STATIC_ROUTE_PATCH_FAILED");
console.log("V5_STATIC_ASSETS=PASS");
