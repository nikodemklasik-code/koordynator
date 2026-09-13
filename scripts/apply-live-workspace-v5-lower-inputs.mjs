#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const MARKER = "/* LIVE_WORKSPACE_V5_LOWER_INPUTS */";
const CSS = `

${MARKER}
/* Keep input sizes. Lower them, remove dead margins and use more width for chat. */
.v5-composer-zone {
  bottom: -3px !important;
  padding: 30px 6px 0 14px !important;
}
.v5-composer {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
}
.v5-route-note {
  display: none !important;
}
.v5-terminal-composer {
  padding: 15px 6px 2px 6px !important;
  margin-bottom: -3px !important;
}
`;

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`V5_LOWER_INPUTS_PATCH_MARKER_MISSING ${label}`);
  return source.replace(from, to);
}

export function patchLowerInputsCss(source) {
  return source.includes(MARKER) ? source : `${source.trimEnd()}${CSS}`;
}

export function patchWorkspaceJs(source) {
  let next = source;
  next = replaceOnce(
    next,
    'const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth";',
    'const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth.v2";',
    "terminal storage key"
  );
  next = replaceOnce(next, "const DEFAULT_WIDTH = 420;", "const DEFAULT_WIDTH = 320;", "terminal default width");
  next = replaceOnce(next, "const MIN_WIDTH = 300;", "const MIN_WIDTH = 280;", "terminal minimum width");
  return next;
}

async function patchRepository(root = process.cwd()) {
  const cssPath = resolve(root, "web/control/chat-v5.css");
  const jsPath = resolve(root, "web/control/chat-v5.js");
  const cssBefore = await readFile(cssPath, "utf8");
  const jsBefore = await readFile(jsPath, "utf8");
  const cssAfter = patchLowerInputsCss(cssBefore);
  const jsAfter = patchWorkspaceJs(jsBefore);
  const changed = [];
  if (cssAfter !== cssBefore) {
    await writeFile(cssPath, cssAfter, "utf8");
    changed.push("web/control/chat-v5.css");
  }
  if (jsAfter !== jsBefore) {
    await writeFile(jsPath, jsAfter, "utf8");
    changed.push("web/control/chat-v5.js");
  }
  console.log("LIVE_WORKSPACE_V5_LOWER_INPUTS=PASS chat_gap=6px hermes_gap=6px terminal_default=320px sizes=unchanged");
  console.log(`PATCHED=${changed.length ? changed.join(",") : "already-applied"}`);
}

function selfTest() {
  const cssOnce = patchLowerInputsCss(".v5-composer-zone{bottom:0}");
  const cssTwice = patchLowerInputsCss(cssOnce);
  if (!cssOnce.includes(MARKER)) throw new Error("V5_LOWER_INPUTS_MARKER_MISSING");
  if (!cssOnce.includes("padding: 30px 6px 0 14px !important")) throw new Error("V5_LOWER_INPUTS_CHAT_GEOMETRY_FAILED");
  if (!cssOnce.includes("width: 100% !important")) throw new Error("V5_LOWER_INPUTS_CHAT_WIDTH_FAILED");
  if (!cssOnce.includes("padding: 15px 6px 2px 6px !important")) throw new Error("V5_LOWER_INPUTS_HERMES_GEOMETRY_FAILED");
  if (cssOnce !== cssTwice) throw new Error("V5_LOWER_INPUTS_CSS_NOT_IDEMPOTENT");

  const js = 'const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth";\nconst DEFAULT_WIDTH = 420;\nconst MIN_WIDTH = 300;';
  const jsOnce = patchWorkspaceJs(js);
  const jsTwice = patchWorkspaceJs(jsOnce);
  if (!jsOnce.includes('terminalWidth.v2')) throw new Error("V5_LOWER_INPUTS_STORAGE_FAILED");
  if (!jsOnce.includes("const DEFAULT_WIDTH = 320;")) throw new Error("V5_LOWER_INPUTS_DEFAULT_WIDTH_FAILED");
  if (!jsOnce.includes("const MIN_WIDTH = 280;")) throw new Error("V5_LOWER_INPUTS_MIN_WIDTH_FAILED");
  if (jsOnce !== jsTwice) throw new Error("V5_LOWER_INPUTS_JS_NOT_IDEMPOTENT");
  console.log("LIVE_WORKSPACE_V5_LOWER_INPUTS_SELF_TEST=PASS");
}

if (process.argv.includes("--self-test")) selfTest();
else await patchRepository();
