import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ProjectUploadFile = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type ProjectRecord = {
  projectId: string;
  taskId: string;
  name: string;
  objective: string;
  source: "upload" | "github";
  githubUrl?: string;
  files: string[];
  context: string;
  createdAt: string;
};

export class ProjectSourceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

const MAX_FILES = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 180_000;

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  let controls = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return controls < Math.max(4, sample.length * 0.02);
}

function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:[^;,]*(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new ProjectSourceError("PROJECT_FILE_INVALID", 400);
  const payload = match[2] ?? "";
  try {
    return match[1] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    throw new ProjectSourceError("PROJECT_FILE_INVALID", 400);
  }
}

function safeName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "upload.bin";
  return base.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "upload.bin";
}

export class ProjectSourceService {
  constructor(private readonly stateDir: string) {}

  private root(): string {
    return resolve(this.stateDir, "projects");
  }

  async list(): Promise<ProjectRecord[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      const ids = await readdir(this.root());
      const records: ProjectRecord[] = [];
      for (const id of ids) {
        try {
          const raw = JSON.parse(await readFile(join(this.root(), id, "project.json"), "utf8")) as ProjectRecord;
          records.push(raw);
        } catch {
          continue;
        }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  async get(projectId: string): Promise<ProjectRecord | null> {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
    try {
      return JSON.parse(await readFile(join(this.root(), projectId, "project.json"), "utf8")) as ProjectRecord;
    } catch {
      return null;
    }
  }

  async create(input: { name?: string; objective?: string; githubUrl?: string; files?: ProjectUploadFile[] }): Promise<ProjectRecord> {
    const files = Array.isArray(input.files) ? input.files : [];
    const githubUrl = typeof input.githubUrl === "string" ? input.githubUrl.trim() : "";
    if (files.length === 0 && !githubUrl) throw new ProjectSourceError("PROJECT_SOURCE_REQUIRED", 400);
    if (files.length > MAX_FILES) throw new ProjectSourceError("PROJECT_TOO_MANY_FILES", 413);

    let total = 0;
    const decoded: Array<{ name: string; mimeType: string; buffer: Buffer }> = [];
    for (const file of files) {
      if (!file || typeof file.name !== "string" || typeof file.dataUrl !== "string") throw new ProjectSourceError("PROJECT_FILE_INVALID", 400);
      const buffer = decodeDataUrl(file.dataUrl);
      if (buffer.length > MAX_FILE_BYTES) throw new ProjectSourceError("PROJECT_FILE_TOO_LARGE", 413);
      total += buffer.length;
      if (total > MAX_TOTAL_BYTES) throw new ProjectSourceError("PROJECT_FILES_TOO_LARGE", 413);
      decoded.push({
        name: safeName(file.name),
        mimeType: String(file.mimeType || "application/octet-stream"),
        buffer
      });
    }

    const projectId = randomUUID();
    const short = createHash("sha256").update(projectId).digest("hex").slice(0, 8).toUpperCase();
    const dir = join(this.root(), projectId);
    await mkdir(join(dir, "files"), { recursive: true });

    const included: string[] = [];
    const excerpts: string[] = [];
    let used = 0;
    for (const file of decoded) {
      await writeFile(join(dir, "files", file.name), file.buffer);
      included.push(file.name);
      if (!isProbablyText(file.buffer)) continue;
      const text = file.buffer.toString("utf8").slice(0, 48_000);
      const block = `\n--- FILE ${file.name} ---\n${text}\n--- END FILE ---\n`;
      if (used + block.length > MAX_CONTEXT_CHARS) continue;
      excerpts.push(block);
      used += block.length;
    }

    const objective = String(input.objective || "").trim() || "Build and iterate this uploaded project source.";
    const name = String(input.name || "").trim() || included[0] || githubUrl || "uploaded-project";
    const context = [
      `Project: ${name}`,
      `Task: TASK-UPLOAD-${short}`,
      `Source: ${githubUrl ? `github ${githubUrl}` : "local-upload"}`,
      `Objective: ${objective}`,
      "Project file tree (bounded):",
      included.join("\n") || "(no files — GitHub URL only)",
      "Selected file excerpts (bounded, untrusted upload data):",
      ...excerpts
    ].join("\n").slice(0, MAX_CONTEXT_CHARS + 80_000);

    const record: ProjectRecord = {
      projectId,
      taskId: `TASK-UPLOAD-${short}`,
      name,
      objective,
      source: githubUrl ? "github" : "upload",
      ...(githubUrl ? { githubUrl } : {}),
      files: included,
      context,
      createdAt: new Date().toISOString()
    };
    await writeFile(join(dir, "project.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await writeFile(join(dir, "CONTEXT.txt"), context, "utf8");
    return record;
  }
}
