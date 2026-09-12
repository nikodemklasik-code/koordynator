#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import readline from "node:readline/promises";

const root = process.cwd();

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout ?? 10 * 60_000,
    shell: false
  });
}

function oauthProviders() {
  const result = run("omniroute", ["oauth", "providers"], { timeout: 20_000 });
  if ((result.status ?? 1) !== 0) throw new Error("OMNIROUTE_OAUTH_PROVIDER_LIST_FAILED");
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function bootstrapRows() {
  const result = run("npm", ["run", "ai:bootstrap"], { timeout: 12 * 60_000 });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z0-9_-]+)\s+(PASS|FAILED|SKIP|MISSING)\s+/i.exec(line);
    if (match) rows.set(match[1].toLowerCase(), match[2].toUpperCase());
  }
  return { rows, text, status: result.status ?? 1 };
}

const targets = [
  { key: "anthropic", label: "Claude / Anthropic", ids: ["claude-code", "claude"] },
  { key: "github", label: "GitHub Copilot", ids: ["github", "copilot"] },
  { key: "gemini", label: "Gemini CLI", ids: ["gemini-cli", "gemini"] },
  { key: "kiro", label: "Kiro", ids: ["kiro"] },
  { key: "kimi", label: "Kimi Coding", ids: ["kimi-coding"] },
  { key: "cursor", label: "Cursor", ids: ["cursor"] },
  { key: "kilocode", label: "KiloCode", ids: ["kilocode"] },
  { key: "cline", label: "Cline", ids: ["cline"] },
  { key: "amazonq", label: "Amazon Q", ids: ["amazon-q", "amazonq"] },
  { key: "antigravity", label: "Antigravity", ids: ["antigravity", "agy"], callbackHint: true }
];

function firstSupported(candidates, listing) {
  const lines = listing.toLowerCase();
  return candidates.find((id) => new RegExp(`(^|\\s)${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(\\s|$)`, "mi").test(lines)) || null;
}

async function main() {
  console.log("Koordynator · one-time provider authentication");
  console.log("This wizard starts vendor consent only when you approve it. Tokens are persisted by OmniRoute; this is NOT a daily startup step.\n");

  const providers = oauthProviders();
  const before = bootstrapRows();
  if (before.text.trim()) console.log(before.text.trim());

  const needed = targets.filter((target) => before.rows.get(target.key) !== "PASS");
  if (!needed.length) {
    console.log("\nAll configured target families already pass live inference. Nothing to authenticate.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const target of needed) {
      const providerId = firstSupported(target.ids, providers);
      if (!providerId) {
        console.log(`\nSKIP ${target.label}: this OmniRoute build does not advertise a supported OAuth flow.`);
        continue;
      }
      const answer = (await rl.question(`\n${target.label} (${providerId}) needs attention. Press Enter to authenticate, s to skip, q to stop: `)).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "s") continue;
      if (target.callbackHint) {
        console.log("Antigravity note: if the browser ends on localhost:8080 with ERR_CONNECTION_REFUSED, copy the full callback URL from the address bar and paste it into this terminal when OmniRoute asks for it.");
      }
      const auth = run("omniroute", ["oauth", "start", "--provider", providerId], { inherit: true, timeout: 15 * 60_000 });
      if ((auth.status ?? 1) !== 0) console.log(`AUTH ${target.label}: command exited ${auth.status ?? 1}; leaving the slot visible for retry.`);
    }
  } finally {
    rl.close();
  }

  console.log("\nRe-running live inference probes...");
  const after = run("npm", ["run", "ai:bootstrap"], { inherit: true, timeout: 12 * 60_000 });
  process.exitCode = after.status ?? 1;
  console.log("\nQoder is intentionally not auto-started here: OmniRoute 3.8.50 recommends PAT/configured OAuth rather than silently launching the experimental flow.");
  console.log("Qwen OAuth is intentionally omitted: that free OAuth tier was retired; use another current route instead.");
  console.log("Astra is a model slot under the Codex/OpenAI route, not a separate vendor login.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "AI_AUTH_MISSING_FAILED");
  process.exitCode = 1;
});
