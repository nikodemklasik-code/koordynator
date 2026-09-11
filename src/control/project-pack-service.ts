import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractChatAttachmentText } from "./chat-attachment-text.js";

export type ProjectPackFileInput = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type ProjectPackResult = {
  packId: string;
  summary: string;
  objectiveHint: string;
  files: Array<{ name: string; mimeType: string; size: number; extractedChars: number }>;
  storedAt: string;
};

const DATA_URL_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const ALLOWED = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "application/x-zip-compressed"
]);

function parseDataUrl(value: string, mimeType: string): Buffer {
  const match = DATA_URL_RE.exec(value);
  if (!match?.[1] || match[2] === undefined) throw Object.assign(new Error("PROJECT_PACK_INVALID"), { code: "PROJECT_PACK_INVALID", status: 400 });
  if (match[1].toLowerCase() !== mimeType.toLowerCase()) {
    throw Object.assign(new Error("PROJECT_PACK_INVALID"), { code: "PROJECT_PACK_INVALID", status: 400 });
  }
  return Buffer.from(match[2], "base64");
}

async function extractZipListing(bytes: Buffer): Promise<string> {
  // Lightweight zip central-directory file name listing without external deps.
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
    const nameLen = bytes.readUInt16LE(offset + 26);
    const extraLen = bytes.readUInt16LE(offset + 28);
    const compSize = bytes.readUInt32LE(offset + 18);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    if (name && !name.endsWith("/")) names.push(name);
    offset += 30 + nameLen + extraLen + compSize;
    if (names.length >= 80) break;
  }
  return names.length
    ? `ZIP entries (bounded):\n${names.join("\n")}`
    : "ZIP archive received (entry listing unavailable).";
}

export class ProjectPackService {
  constructor(private readonly stateDir: string) {}

  async ingest(files: ProjectPackFileInput[]): Promise<ProjectPackResult> {
    if (!Array.isArray(files) || files.length === 0) {
      throw Object.assign(new Error("PROJECT_PACK_REQUIRED"), { code: "PROJECT_PACK_REQUIRED", status: 400 });
    }
    if (files.length > 8) {
      throw Object.assign(new Error("PROJECT_PACK_TOO_MANY_FILES"), { code: "PROJECT_PACK_TOO_MANY_FILES", status: 413 });
    }

    const packId = randomUUID();
    const excerpts: string[] = [];
    const meta: ProjectPackResult["files"] = [];
    let total = 0;

    for (const file of files) {
      const name = String(file.name || "").trim();
      const mimeType = String(file.mimeType || "").trim().toLowerCase();
      if (!name || name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(name)) {
        throw Object.assign(new Error("PROJECT_PACK_INVALID"), { code: "PROJECT_PACK_INVALID", status: 400 });
      }
      if (!ALLOWED.has(mimeType) && !mimeType.startsWith("text/")) {
        throw Object.assign(new Error("PROJECT_PACK_TYPE_UNSUPPORTED"), { code: "PROJECT_PACK_TYPE_UNSUPPORTED", status: 415 });
      }
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 12 * 1024 * 1024) {
        throw Object.assign(new Error("PROJECT_PACK_TOO_LARGE"), { code: "PROJECT_PACK_TOO_LARGE", status: 413 });
      }
      const bytes = parseDataUrl(String(file.dataUrl || ""), mimeType);
      if (bytes.length !== file.size) {
        throw Object.assign(new Error("PROJECT_PACK_INVALID"), { code: "PROJECT_PACK_INVALID", status: 400 });
      }
      total += bytes.length;
      if (total > 20 * 1024 * 1024) {
        throw Object.assign(new Error("PROJECT_PACK_TOO_LARGE"), { code: "PROJECT_PACK_TOO_LARGE", status: 413 });
      }

      let extracted = await extractChatAttachmentText({ name, mimeType, bytes });
      if (!extracted && (mimeType.includes("zip") || name.toLowerCase().endsWith(".zip"))) {
        extracted = await extractZipListing(bytes);
      }
      const text = (extracted || `[binary attachment: ${name}]`).slice(0, 60_000);
      excerpts.push(`## ${name}\n${text}`);
      meta.push({ name, mimeType, size: bytes.length, extractedChars: text.length });
    }

    const summary = excerpts.join("\n\n").slice(0, 120_000);
    const objectiveHint = `Implement and verify the attached project pack (${meta.map((item) => item.name).join(", ")}): follow contracts/docs, keep builds hermetic, and produce an exact releasable candidate.`;
    const storedAt = new Date().toISOString();
    const dir = resolve(this.stateDir, "project-packs", packId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, "summary.md"), `${summary}\n`, { encoding: "utf8", mode: 0o600 });
    await writeFile(join(dir, "meta.json"), `${JSON.stringify({ packId, storedAt, files: meta, objectiveHint }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    return { packId, summary, objectiveHint, files: meta, storedAt };
  }
}
