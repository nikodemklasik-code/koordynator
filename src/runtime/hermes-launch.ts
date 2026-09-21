import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadHermesGrants, type HermesGrantStatus } from "../control/hermes-grant-store.js";
import { mintTaskTicket } from "../security/task-ticket.js";
import { startTicketProxy, type TicketProxy } from "../security/ticket-proxy.js";
import { omniRouteSettings } from "./local-config.js";
import { freeRouteGuard } from "./free-routes.js";
import { WORKSPACE_REPOSITORY_POLICIES } from "../control/workspace-repository-policy.js";

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("HERMES_PROFILE_PATH_UNSAFE");
  await chmod(path, 0o700);
}

async function privateFile(path: string, content: string): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await file.chmod(0o600); await file.writeFile(content, "utf8"); }
  finally { await file.close(); }
}

const STRIP_FROM_CHILD = [
  "OMNIROUTE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY"
];

function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIP_FROM_CHILD) delete next[key];
  return next;
}

function fallbackProviders(endpoint: string, settings: ReturnType<typeof omniRouteSettings>, env: NodeJS.ProcessEnv = process.env) {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const raw of (env.KOORDYNATOR_FALLBACK_MODELS ?? "").split(",")) {
    const model = raw.trim();
    if (!model || model === settings.model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length >= 6) break;
  }
  return models.map(model => ({
    provider: "custom",
    model,
    base_url: endpoint,
    key_env: "OPENAI_API_KEY"
  }));
}

function hermesBinary(env: NodeJS.ProcessEnv): string {
  const configured = env.KOORDYNATOR_HERMES_BIN?.trim();
  if (configured) return configured;
  const home = env.HOME?.trim();
  if (home) {
    const local = join(home, ".local", "bin", "hermes");
    if (existsSync(local)) return local;
  }
  return "hermes";
}

function realUserHome(env: NodeJS.ProcessEnv): string {
  const value = env.HERMES_REAL_HOME?.trim() || env.HOME?.trim();
  return resolve(value || homedir());
}

const HERMES_INTERACTIVE_TICKET_TTL_MS = 8 * 60 * 60_000;

function hermesTicketTtlMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.KOORDYNATOR_HERMES_TICKET_TTL_MS ?? "");
  if (!Number.isFinite(configured) || configured <= 0) return HERMES_INTERACTIVE_TICKET_TTL_MS;
  return Math.max(5 * 60_000, Math.min(configured, 24 * 60 * 60_000));
}

function dynamicSkillRoots(root: string, env: NodeJS.ProcessEnv): string[] {
  const home = realUserHome(env);
  return [...new Set([
    join(home, ".hermes", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
    resolve(root, ".hermes", "skills"),
    resolve(root, ".agents", "skills"),
    resolve(root, "skills"),
    resolve(root, ".orchestrator", "dynamic-skills")
  ])];
}

function managedSoul(grants: HermesGrantStatus): string {
  const explicitRoots = grants.localRoots ?? [];
  const roots = grants.localFiles && explicitRoots.length
    ? explicitRoots.map((root) => `- ${root}`).join("\n")
    : "- none explicitly granted";
  return `# Koordynator managed Hermes runtime\n\n` +
    `## Skill routing\n` +
    `For every substantive task, inspect the available skill index and load the smallest relevant set of existing skills before acting. ` +
    `Use skills_list/skill_view rather than guessing a skill's contents. If no suitable reusable skill exists and the task describes a repeatable workflow, create a narrowly scoped skill with skill_manage, then load it. ` +
    `Do not create skills for trivial conversation. Never claim a skill executed unless the turn actually used its instructions or tools.\n\n` +
    `## Local files\n` +
    `The terminal runs on the host under the operator's OS account when terminal access is granted. Do not claim that a path is inaccessible from memory: test access with the available file/terminal tools first. ` +
    `Only inspect files required by the user's task. Never sweep the home directory, credential stores, browser profiles, keychains, SSH keys, tokens, or unrelated private data.\n` +
    `Explicit Koordynator local-file roots:\n${roots}\n\n` +
    `If macOS returns EPERM/EACCES for Desktop, Documents, iCloud Drive or another protected folder, report MACOS_TCC_REQUIRED. Do not bypass macOS privacy controls.\n\n` +
    `## Evidence\n` +
    `Separate observable tool output from inference. NOT_TESTED or UNEXECUTED is never PASS.\n`;
}


function protectedPushPolicy(): Record<string, string[]> {
  const policy: Record<string, string[]> = {};
  for (const item of Object.values(WORKSPACE_REPOSITORY_POLICIES)) {
    if (item.repository && item.protectedBranches.length) policy[item.repository.toLowerCase()] = [...item.protectedBranches];
  }
  return policy;
}

async function prepareGitGuard(home: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const realGit = env.KOORDYNATOR_REAL_GIT?.trim()
    || (existsSync("/usr/bin/git") ? "/usr/bin/git" : existsSync("/usr/local/bin/git") ? "/usr/local/bin/git" : "");
  const grantFile = env.KOORDYNATOR_OWNER_PUSH_GRANT_FILE?.trim();
  if (!realGit || !grantFile) return null;

  const bin = join(home, "bin");
  await privateDirectory(bin);
  const wrapper = join(bin, "git");
  const policy = JSON.stringify(protectedPushPolicy());
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const REAL_GIT = ${JSON.stringify(realGit)};
const GRANT_FILE = ${JSON.stringify(grantFile)};
const POLICY = ${policy};

function repositoryFromRemote() {
  try {
    const remote = cp.execFileSync(REAL_GIT, ["remote", "get-url", "origin"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    let match = /^https?:\\/\\/github\\.com\\/([^/]+)\\/([^/]+?)(?:\\.git)?$/.exec(remote);
    if (!match) match = /^git@github\\.com:([^/]+)\\/([^/]+?)(?:\\.git)?$/.exec(remote);
    if (!match) match = /^ssh:\\/\\/git@github\\.com\\/([^/]+)\\/([^/]+?)(?:\\.git)?$/.exec(remote);
    return match ? (match[1] + "/" + match[2]).toLowerCase() : "";
  } catch { return ""; }
}
function currentBranch() {
  try { return cp.execFileSync(REAL_GIT, ["branch", "--show-current"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function consumeGrant(repository, branch) {
  try {
    const parsed = JSON.parse(fs.readFileSync(GRANT_FILE, "utf8"));
    const now = Date.now();
    const grants = Array.isArray(parsed.grants) ? parsed.grants : [];
    const index = grants.findIndex((g) => g && String(g.repository || "").toLowerCase() === repository && g.branch === branch && Date.parse(g.expiresAt) > now);
    if (index < 0) return false;
    grants.splice(index, 1);
    const fresh = grants.filter((g) => Date.parse(g.expiresAt) > now);
    const tmp = GRANT_FILE + "." + process.pid + ".tmp";
    fs.mkdirSync(path.dirname(GRANT_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify({ grants: fresh }, null, 2) + "\\n", { mode: 0o600 });
    fs.renameSync(tmp, GRANT_FILE);
    return true;
  } catch { return false; }
}
function protectedTargets(args, protectedBranches) {
  const pushIndex = args.indexOf("push");
  if (pushIndex < 0) return [];
  const tail = args.slice(pushIndex + 1);
  const deleteMode = tail.includes("--delete") || tail.includes("-d");
  const forceMode = tail.some((arg) => arg === "--force" || arg === "-f" || arg.startsWith("--force-with-lease"));
  const positional = tail.filter((arg) => !arg.startsWith("-"));
  const refspecs = positional.length > 1 ? positional.slice(1) : [];
  const current = currentBranch();
  const targets = (refspecs.length ? refspecs : [current]).map((raw) => {
    let spec = String(raw || "");
    const plus = spec.startsWith("+");
    if (plus) spec = spec.slice(1);
    const dest = spec.includes(":") ? spec.split(":").pop() : spec;
    const branch = dest === "HEAD" || !dest ? current : dest.replace(/^refs\\/heads\\//, "");
    return { branch, force: forceMode || plus, delete: deleteMode || spec.startsWith(":") };
  });
  return targets.filter((item) => protectedBranches.includes(item.branch));
}

const args = process.argv.slice(2);
const repository = repositoryFromRemote();
const protectedBranches = POLICY[repository] || [];
const targets = protectedTargets(args, protectedBranches);
for (const target of targets) {
  if (target.force || target.delete) {
    process.stderr.write("KOORDYNATOR_PROTECTED_BRANCH_FORCE_OR_DELETE_DENIED " + repository + " " + target.branch + "\\n");
    process.exit(77);
  }
  if (!consumeGrant(repository, target.branch)) {
    process.stderr.write("KOORDYNATOR_OWNER_PUSH_APPROVAL_REQUIRED " + repository + " " + target.branch + "\\n");
    process.exit(77);
  }
}
const result = cp.spawnSync(REAL_GIT, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
if (result.error) { process.stderr.write(String(result.error.message || result.error) + "\\n"); process.exit(126); }
process.exit(result.status == null ? 1 : result.status);
`;
  await privateFile(wrapper, source);
  await chmod(wrapper, 0o700);
  return bin;
}

async function prepareManagedSkills(home: string): Promise<void> {
  const skillsRoot = join(home, "skills");
  const skill = join(skillsRoot, "koordynator-dynamic-routing");
  await privateDirectory(skillsRoot);
  await privateDirectory(skill);
  await privateFile(join(skill, "SKILL.md"), `---\nname: koordynator-dynamic-routing\ndescription: Always-use routing policy for Koordynator tasks: discover and load existing skills first, create a narrow reusable skill only when a repeatable capability is genuinely missing, and preserve execution evidence.\nversion: 1.0.0\nplatforms: [macos, linux]\nmetadata:\n  hermes:\n    tags: [routing, skills, orchestration, verification]\n---\n\n# Koordynator Dynamic Skill Routing\n\n## Procedure\n1. Read the user's requested outcome and identify the smallest capabilities needed.\n2. Call skills_list to search the available skill index, then load relevant skills with skill_view before following them.\n3. Prefer an existing trusted/local skill over inventing a new one.\n4. If no suitable skill exists and the workflow is reusable, create one with skill_manage. Keep its scope narrow, include verification steps, and never embed secrets.\n5. Execute only what the user authorized. A skill is procedure, not permission to expand scope.\n6. Report actual tests/tool receipts. UNEXECUTED and NOT_TESTED are not PASS.\n`);
}

export type HermesLaunch = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  close: () => Promise<void>;
};

/** Managed, repo-local profile: global Nous/OpenRouter configuration is never edited. */
export async function prepareHermes(settings: ReturnType<typeof omniRouteSettings>, root = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<HermesLaunch> {
  if (!settings.apiKey) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  const authorizeModel = env.KOORDYNATOR_FREE_ONLY === "1" ? freeRouteGuard(settings) : undefined;
  if (authorizeModel && !await authorizeModel(settings.model)) throw new Error("FREE_ROUTE_DENIED");
  const state = resolve(root, ".orchestrator");
  await privateDirectory(state);
  const home = join(state, "hermes-omniroute");
  await privateDirectory(home);

  const secret = randomBytes(32).toString("hex");
  // Interactive PTY sessions live much longer than short task workers. The token is still
  // scoped to this loopback proxy and becomes unusable as soon as launch.close() closes it.
  const { token } = mintTaskTicket(secret, {
    aud: "hermes",
    model: settings.model,
    ttlMs: hermesTicketTtlMs(env)
  });
  let proxy: TicketProxy | undefined;
  try {
    proxy = await startTicketProxy({ upstream: settings.endpoint, apiKey: settings.apiKey, secret, audience: "hermes",
      ...(authorizeModel ? { authorizeModel } : {}) });
    const fallbacks = [];
    for (const fallback of fallbackProviders(proxy.url, settings, env)) {
      if (!authorizeModel || await authorizeModel(fallback.model)) fallbacks.push(fallback);
    }
    const grants = await loadHermesGrants(join(root, ".orchestrator"));
    await prepareManagedSkills(home);
    const gitGuardBin = await prepareGitGuard(home, env);
    await privateFile(join(home, "SOUL.md"), managedSoul(grants) +
      "\n## Protected Git branches\nProtected branches require a fresh owner approval scoped to the current repository and branch. Never bypass the managed git guard, never call an absolute git binary to evade it, and never force-push or delete a protected branch.\n");
    const externalDirs = dynamicSkillRoots(root, env);
    const config: Record<string, unknown> = {
      model: { provider: "custom", default: settings.model, base_url: proxy.url,
        api_mode: "chat_completions", key_env: "OPENAI_API_KEY" },
      approvals: { mode: grants.terminal ? "off" : "smart" },
      terminal: { cwd: resolve(root) },
      skills: { external_dirs: externalDirs, template_vars: true, inline_shell: false }
    };
    if (!grants.terminal) config.disabled_toolsets = ["terminal"];
    if (fallbacks.length > 0) config.fallback_providers = fallbacks;
    await privateFile(join(home, "config.yaml"), JSON.stringify(config, null, 2) + "\n");
    await privateFile(join(home, ".env"), "# Credentials are a short-lived task ticket, never the gateway key.\n");
    const held = proxy;
    const localRoots = grants.localFiles ? (grants.localRoots ?? []) : [];
    return {
      command: hermesBinary(env),
      args: ["chat", "--provider", "custom", "--model", settings.model],
      cwd: resolve(root),
      env: {
        ...childEnvironment(env),
        HERMES_HOME: home,
        HERMES_REAL_HOME: realUserHome(env),
        HERMES_INFERENCE_PROVIDER: "custom",
        HERMES_INFERENCE_MODEL: settings.model,
        KOORDYNATOR_LOCAL_FILE_ROOTS: JSON.stringify(localRoots),
        ...(gitGuardBin ? { PATH: `${gitGuardBin}:${childEnvironment(env).PATH ?? ""}` } : {}),
        CUSTOM_BASE_URL: held.url,
        OPENAI_BASE_URL: held.url,
        OPENAI_API_KEY: token,
        OMNIROUTE_TASK_TICKET: token,
        OPENROUTER_API_KEY: "",
        OPENROUTER_BASE_URL: ""
      },
      close: () => held.close()
    };
  } catch (error) {
    await proxy?.close().catch(() => undefined);
    throw error;
  }
}
