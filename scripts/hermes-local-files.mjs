#!/usr/bin/env node
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const stateDir = join(repoRoot, ".orchestrator");
const grantsPath = join(stateDir, "hermes-grants.json");
const realHome = resolve(process.env.HERMES_REAL_HOME || process.env.HOME || homedir());

function requestedRoots() {
  const roots = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--root") continue;
    const next = process.argv[index + 1];
    if (!next) throw new Error("HERMES_LOCAL_FILES_ROOT_REQUIRED");
    roots.push(resolve(next.replace(/^~(?=\/|$)/, realHome)));
    index += 1;
  }
  if (!roots.length) roots.push(realHome);
  return [...new Set(roots)];
}

async function readCurrent() {
  try {
    const parsed = JSON.parse(await readFile(grantsPath, "utf8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function persist(roots) {
  const current = await readCurrent();
  const next = {
    ...current,
    terminal: true,
    localFiles: true,
    localRoots: roots,
    updatedAt: new Date().toISOString()
  };
  await mkdir(dirname(grantsPath), { recursive: true, mode: 0o700 });
  await writeFile(grantsPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(grantsPath, 0o600);
}

async function probe(path) {
  try {
    await access(path, constants.R_OK | constants.W_OK);
    await readdir(path);
    return { path, status: "PASS", detail: "read/list access available" };
  } catch (error) {
    const code = error?.code || "ERROR";
    if (code === "ENOENT") return { path, status: "SKIP", detail: "path does not exist" };
    if (code === "EPERM" || code === "EACCES") return { path, status: "BLOCKED", detail: `${code} · macOS/privacy or filesystem permission` };
    return { path, status: "FAILED", detail: code };
  }
}

function protectedCandidates() {
  return [
    join(realHome, "Desktop"),
    join(realHome, "Documents"),
    join(realHome, "Downloads"),
    join(realHome, "Library", "Mobile Documents", "com~apple~CloudDocs")
  ];
}

async function main() {
  const roots = requestedRoots();
  console.log("Koordynator · Hermes local files grant");
  console.log("This grants the managed Hermes runtime permission to use its terminal/file tools inside the listed roots.");
  console.log("It does NOT bypass macOS Privacy & Security and it does NOT grant access to Keychain, browser secrets, tokens or unrelated credentials.\n");
  for (const root of roots) console.log(`  ROOT ${root}`);

  if (!process.argv.includes("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question("\nType YES to grant local-file access to these roots: ")).trim();
      if (answer !== "YES") {
        console.log("LOCAL_FILES_GRANT=CANCELLED");
        return;
      }
    } finally {
      rl.close();
    }
  }

  await persist(roots);
  console.log(`\nLOCAL_FILES_GRANT=READY ${grantsPath}`);

  const checks = [...roots, ...protectedCandidates()].filter((value, index, values) => values.indexOf(value) === index);
  let blocked = false;
  for (const path of checks) {
    const result = await probe(path);
    if (result.status === "BLOCKED") blocked = true;
    console.log(`${result.status.padEnd(7)} ${result.path} · ${result.detail}`);
  }

  const skillRoot = join(realHome, ".hermes", "skills");
  const skillProbe = await probe(skillRoot);
  console.log(`\nHERMES_SKILLS=${skillProbe.status} ${skillRoot}`);
  console.log("Koordynator's managed Hermes profile now indexes ~/.hermes/skills plus supported shared/project skill directories dynamically on each new Hermes session.");

  if (blocked && process.platform === "darwin") {
    console.log("\nMACOS_TCC_REQUIRED: at least one protected folder is blocked.");
    console.log("Opening System Settings → Privacy & Security → Full Disk Access. Grant access to the terminal/runtime you use to start Koordynator, then restart Koordynator.");
    spawnSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"], { stdio: "ignore" });
  }

  console.log("\nRestart Hermes/Koordynator after this grant so the managed profile is regenerated with the new roots.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "HERMES_LOCAL_FILES_FAILED");
  process.exitCode = 1;
});
