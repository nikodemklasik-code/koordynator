import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".hermes.md",
  "docs/SPEC_PIN.md",
  "docs/HERMES_OMNIROUTE.md",
  "docs/OPERATOR_FIRST_RUN.md",
  ".orchestrator/hermes-omniroute/SOUL.md"
];

async function readOptional(path: string, maxChars: number): Promise<{ path: string; text: string } | null> {
  try {
    const raw = await readFile(path, "utf8");
    const text = raw.trim();
    if (!text) return null;
    return { path, text: text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text };
  } catch {
    return null;
  }
}

export async function loadChatProjectContext(root = process.cwd()): Promise<string | null> {
  const sections: string[] = [];
  for (const relative of DEFAULT_FILES) {
    const loaded = await readOptional(resolve(root, relative), 6_000);
    if (!loaded) continue;
    sections.push(`## ${relative}\n${loaded.text}`);
    if (sections.join("\n\n").length > 20_000) break;
  }
  if (sections.length === 0) return null;
  return [
    "You are assisting inside the Koordynator project control chat.",
    "Use the following project contracts and environment notes when relevant.",
    "Treat them as authoritative project guidance, not as user-provided secrets.",
    "",
    sections.join("\n\n")
  ].join("\n");
}
