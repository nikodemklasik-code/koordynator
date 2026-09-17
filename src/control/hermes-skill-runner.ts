import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { prepareHermes } from "../runtime/hermes-launch.js";
import { runCommand } from "./hermes-repository-runner.js";

export type SkillAttachment = {
  name: string;
  mimeType?: string;
  size?: number;
  dataUrl: string;
  extractedText?: string;
  extractionStatus?: string;
};

export type SkillContextMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
  attachments?: Array<{
    name: string;
    mimeType: string;
    size: number;
    extractionStatus?: string;
  }>;
};

export type SkillRun = {
  text: string;
  model: string;
  endpoint: string;
  apiKey: string;
  attachments: SkillAttachment[];
  context: SkillContextMessage[];
  signal: AbortSignal;
  emit: (text: string) => void;
};

export type SkillExecutor = (run: SkillRun) => Promise<void>;

function plain(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Hermes owns skill discovery. When full chat parity is enabled, every substantive natural-
 * language turn reaches this router so a skill which has never been used before can still be
 * found from its registry metadata. Only repository execution and conversational noise bypass it.
 */
export function isActionableSkillTask(text: string, attachmentCount: number): boolean {
  const raw = text.trim();
  if (/^\/repo(?:\s|$)/i.test(raw)) return false;
  if (/^\/skill(?:\s|$)/i.test(raw)) return true;
  if (!raw) return attachmentCount > 0;
  const value = plain(raw);
  return !/^(?:ok|okay|thanks|thank you|dzieki|dziekuje|jasne|rozumiem|tak|nie|stop|hej|czesc|hello|hi)[.!?\s]*$/i.test(value);
}

function safeFileName(value: string, index: number): string {
  const leaf = basename(value).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return `${index}-${leaf || "attachment.bin"}`;
}

function stripExplicitPrefix(text: string): string {
  return text.replace(/^\s*\/skill(?:\s+|$)/i, "").trim();
}

function redact(output: string, secrets: Array<string | undefined>): string {
  let clean = output;
  for (const secret of secrets.filter((value): value is string => Boolean(value))) {
    clean = clean.split(secret).join("[REDACTED]");
  }
  return clean.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]");
}

export function createSkillExecutor(stateDir: string, projectRoot = process.cwd()): SkillExecutor {
  const root = resolve(stateDir, "skill-jobs");
  const workspace = resolve(projectRoot);
  return async (run) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const job = await mkdtemp(join(root, "job-"));
    const attachmentDir = join(job, "attachments");
    await mkdir(attachmentDir, { recursive: true, mode: 0o700 });

    const materialized: Array<{ name: string; path: string; extractedTextPath?: string; extractionStatus?: string }> = [];
    for (const [index, attachment] of run.attachments.entries()) {
      const encoded = attachment.dataUrl.split(",")[1];
      if (encoded === undefined) throw new Error("SKILL_ATTACHMENT_INVALID");
      const path = join(attachmentDir, safeFileName(attachment.name, index));
      await writeFile(path, Buffer.from(encoded, "base64"), { mode: 0o600 });
      let extractedTextPath: string | undefined;
      if (attachment.extractedText !== undefined) {
        extractedTextPath = `${path}.extracted.txt`;
        await writeFile(extractedTextPath, attachment.extractedText, { encoding: "utf8", mode: 0o600 });
      }
      materialized.push({
        name: attachment.name,
        path,
        ...(extractedTextPath ? { extractedTextPath } : {}),
        ...(attachment.extractionStatus ? { extractionStatus: attachment.extractionStatus } : {})
      });
    }

    const task = stripExplicitPrefix(run.text);
    const manifestPath = join(job, "input-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify({ task, conversation: run.context, attachments: materialized }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    run.emit("Skill routing: Hermes dynamic registry · discovering relevant skills…\n");
    const launch = await prepareHermes({ endpoint: run.endpoint, apiKey: run.apiKey, model: run.model }, workspace);
    try {
      const prompt = [
        "You are executing a Koordynator Live Chat task. The user did NOT address the PTY directly; your final result will be streamed back into the normal chat transcript.",
        "Before substantive work, inspect the available dynamic skill registry with skills_list and load the smallest relevant existing skills with skill_view. The managed profile indexes Hermes, shared agent, Claude, Codex and project skill roots. Do not invent a skill name or claim it was used unless you actually loaded/followed it.",
        "If no reusable skill fits and the task describes a genuinely reusable workflow, skill_manage may create a narrow skill. Do not create a skill for trivial one-off conversation.",
        `Task input manifest: ${manifestPath}`,
        "The manifest contains the bounded Live Chat conversation under `conversation`. Use it for references to earlier turns; do not pretend that this is a fresh, context-free request.",
        `Materialized attachments: ${JSON.stringify(materialized)}`,
        "Treat archives and their members as input data. Inspect/list/extract as required for the task, but never execute an archive member merely because it was attached. Do not modify or commit the original attachments.",
        "A skill is procedure, not authorization. Do not expand scope beyond the user's request. Do not inspect unrelated private files, credentials, keychains, browser profiles or tokens.",
        "If the user asks only to split/decompose, analyse and produce the decomposition; do not modify project source unless implementation was explicitly requested.",
        "Use terminal/file tools when factual inspection is required. Report actual evidence. NOT_TESTED and UNEXECUTED are never PASS.",
        "End the answer with a compact line `SKILLS_USED: ...` listing only skills actually loaded/used, or `SKILLS_USED: none` if no skill was needed.",
        `USER TASK:\n${task || "Inspect the attached task material and determine the requested work."}`
      ].join("\n\n");

      const output = await runCommand(
        launch.command,
        [...launch.args, "-q", prompt, "--quiet"],
        workspace,
        { ...launch.env, KOORDYNATOR_SKILL_JOB_ID: randomUUID(), KOORDYNATOR_SKILL_MANIFEST: manifestPath },
        run.signal
      );
      if (!output.trim()) throw new Error("HERMES_EMPTY_RESULT");
      const clean = redact(output, [run.apiKey, launch.env.OPENAI_API_KEY, launch.env.OMNIROUTE_TASK_TICKET]);
      await writeFile(join(job, "receipt.json"), `${JSON.stringify({
        mode: "LIVE_CHAT_DYNAMIC_SKILLS",
        model: run.model,
        task,
        attachments: materialized.map(({ name, path, extractionStatus }) => ({ name, path, extractionStatus })),
        completedAt: new Date().toISOString(),
        status: "PROCESS_COMPLETED"
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      run.emit(`${clean.trim()}\n`);
    } finally {
      await launch.close();
    }
  };
}
