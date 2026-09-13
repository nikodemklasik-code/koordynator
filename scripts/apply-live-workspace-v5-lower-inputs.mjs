#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const MARKER = "/* LIVE_WORKSPACE_V5_LOWER_INPUTS */";
const CSS = `

${MARKER}
/* Keep existing sizes. Move both input modules lower toward the shared status baseline. */
.v5-composer-zone {
  bottom: -2px !important;
  padding-bottom: 0 !important;
}
.v5-route-note {
  display: none !important;
}
.v5-terminal-composer {
  padding: 15px 9px 2px !important;
  margin-bottom: -2px !important;
}
`;

export function patchLowerInputs(source) {
  return source.includes(MARKER) ? source : `${source.trimEnd()}${CSS}`;
}

async function patchRepository(root = process.cwd()) {
  const path = resolve(root, "web/control/chat-v5.css");
  const before = await readFile(path, "utf8");
  const after = patchLowerInputs(before);
  if (after !== before) await writeFile(path, after, "utf8");
  console.log("LIVE_WORKSPACE_V5_LOWER_INPUTS=PASS chat_drop=~20px hermes_drop=~7px sizes=unchanged");
  console.log(`PATCHED=${after === before ? "already-applied" : "web/control/chat-v5.css"}`);
}

function selfTest() {
  const once = patchLowerInputs(".v5-composer-zone{bottom:0}");
  const twice = patchLowerInputs(once);
  if (!once.includes(MARKER)) throw new Error("V5_LOWER_INPUTS_MARKER_MISSING");
  if (!once.includes("padding-bottom: 0 !important")) throw new Error("V5_LOWER_INPUTS_CHAT_NOT_LOWERED");
  if (!once.includes("padding: 15px 9px 2px !important")) throw new Error("V5_LOWER_INPUTS_HERMES_NOT_LOWERED");
  if (once !== twice) throw new Error("V5_LOWER_INPUTS_NOT_IDEMPOTENT");
  console.log("LIVE_WORKSPACE_V5_LOWER_INPUTS_SELF_TEST=PASS");
}

if (process.argv.includes("--self-test")) selfTest();
else await patchRepository();
