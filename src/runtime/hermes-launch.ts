import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadHermesGrants, type HermesGrantStatus } from "../control/hermes-grant-store.js";
import { mintTaskTicket } from "../security/task-ticket.js";
import { startTicketProxy, type TicketProxy } from "../security/ticket-proxy.js";
import { omniRouteSettings } from "./local-config.js";

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

function realUserHome(env: NodeJS.ProcessEnv): string {
  const value = env.HERMES_REAL_HOME?.trim() || env.HOME?.trim();
  return resolve(value || homedir());
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
  const roots = grants.localFiles && grants.localRoots.length
    ? grants.localRoots.map((root) => `- ${root}`).join("\n")
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

async function prepareManagedSkills(home: string): Promise<void> {
  const skillsRoot = join(home, "skills");
  const skill = join(skillsRoot, "koordynator-dynamic-routing");
  await privateDirectory(skillsRoot);
  await privateDirectory(skill);
  await privateFile(join(skill, "SKILL.md"), `---\nname: koordynator-dynamic-routing\ndescription: Always-use routing policy for Koordynator tasks: discover and load existing skills first, create a narrow reusable skill only when a repeatable capability is genuinely missing, and preserve execution evidence.\nversion: 1.0.0\nplatforms: [macos, linux]\nmetadata:\n  hermes:\n    tags: [routing, skills, orchestration, verification]\n---\n\n# Koordynator Dynamic Skill Routing\n\n## Procedure\n1. Read the user's requested outcome and identify the smallest capabilities needed.\n2. Search the available skill index. Load relevant skills with skill_view before following them.\n3. Prefer an existing trusted/local skill over inventing a new one.\n4. If no suitable skill exists and the workflow is reusable, create one with skill_manage. Keep its scope narrow, include verification steps, and never embed secrets.\n5. Execute only what the user authorized. A skill is procedure, not permission to expand scope.\n6. Report actual tests/tool receipts. UNEXECUTED and NOT_TESTED are not PASS.\n`);
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
  const state = resolve(root, ".orchestrator");
  await privateDirectory(state);
  const home = join(state, "hermes-omniroute");
  await privateDirectory(home);

  const secret = randomBytes(32).toString("hex");
  const { token } = mintTaskTicket(secret, { aud: "hermes", model: settings.model });
  let proxy: TicketProxy | undefined;
  try {
    proxy = await startTicketProxy({ upstream: settings.endpoint, apiKey: settings.apiKey, secret, audience: "hermes" });
    const fallbacks = fallbackProviders(proxy.url, settings, env);
    const grants = await loadHermesGrants(join(root, ".orchestrator"));
    await prepareManagedSkills(home);
    await privateFile(join(home, "SOUL.md"), managedSoul(grants));
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
    const localRoots = grants.localFiles ? grants.localRoots : [];
    return {
      command: "hermes",
      args: ["chat", "--provider", "custom", "--model", settings.model],
      cwd: resolve(root),
      env: {
        ...childEnvironment(env),
        HERMES_HOME: home,
        HERMES_REAL_HOME: realUserHome(env),
        HERMES_INFERENCE_PROVIDER: "custom",
        HERMES_INFERENCE_MODEL: settings.model,
        KOORDYNATOR_LOCAL_FILE_ROOTS: JSON.stringify(localRoots),
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
