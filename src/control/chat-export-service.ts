import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  ChatContextSelectionError,
  normalizeChatContextSelection,
  selectChatContext,
  type ChatContextSelection,
  type SelectedChatContext
} from "./chat-context-selection.js";
import { ChatService, type ChatAttachment, type ChatMessage, type ChatSession } from "./chat-service.js";

export type ChatExportOutput = "pdf" | "docx" | "pdf+docx" | "zip";
export type ChatExportFileKind = "PDF" | "DOCX" | "ZIP";

export type ChatExportGeneratedFile = {
  fileId: string;
  kind: ChatExportFileKind;
  name: string;
  path: string;
  size: number;
  sha256: string;
};

export type ChatExportReceipt = {
  exportId: string;
  sessionId: string;
  createdAt: string;
  output: ChatExportOutput;
  directory: string;
  responseIds: string[];
  attachmentIds: string[];
  files: ChatExportGeneratedFile[];
};

export type ChatExportRequest = ChatContextSelection & {
  output: ChatExportOutput;
};

export class ChatExportError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ChatExportError";
  }
}

export type ChatExportLauncher = (action: "open" | "reveal", path: string) => Promise<void>;

export type ChatExportServiceOptions = {
  stateDir: string;
  chat: ChatService;
  exportRoot?: string;
  launcher?: ChatExportLauncher;
};

type ExportSafeMetadata = {
  agent?: unknown;
  skills?: unknown;
  tools?: unknown;
  executionSummary?: unknown;
};

type ManifestItem = {
  item_id: string;
  type: "ai_response" | "attachment";
  name: string;
  model?: string;
  timestamp: string;
  sha256: string;
  source_session: string;
  selected_manually: true;
  archive_path?: string;
};

const EXPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = EXPORT_ID_RE;
const ALLOWED_OUTPUTS = new Set<ChatExportOutput>(["pdf", "docx", "pdf+docx", "zip"]);

function sha256(bytes: Uint8Array | Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sessionTitle(session: ChatSession): string {
  const firstUser = session.messages.find((message) => message.role === "user");
  const text = firstUser?.content.trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 80);
  const attachment = firstUser?.attachments?.[0]?.name;
  return attachment || `Chat-${session.sessionId.slice(0, 8)}`;
}

function safeName(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

function archiveName(value: string, fallback: string): string {
  return safeName(value, fallback).replace(/\s+/g, "-");
}

function slug(value: string): string {
  return archiveName(value.toLowerCase(), "response")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "response";
}

function timestampFolder(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

function decodeAttachment(attachment: ChatAttachment): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(attachment.dataUrl);
  if (!match?.[2]) throw new ChatExportError("CHAT_EXPORT_ATTACHMENT_INVALID", 400);
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    throw new ChatExportError("CHAT_EXPORT_ATTACHMENT_INVALID", 400);
  }
}

function explicitMetadata(message: ChatMessage): { agent: string; skills: string; tools: string; executionSummary?: string } {
  const source = message as ChatMessage & ExportSafeMetadata;
  const agent = typeof source.agent === "string" && source.agent.trim() ? source.agent.trim() : "Koordynator";
  const skills = Array.isArray(source.skills)
    ? source.skills.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).join(", ")
    : "";
  const tools = Array.isArray(source.tools)
    ? source.tools.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).join(", ")
    : "";
  const executionSummary = typeof source.executionSummary === "string" && source.executionSummary.trim()
    ? source.executionSummary.trim()
    : undefined;
  return {
    agent,
    skills: skills || "not recorded",
    tools: tools || "not recorded",
    ...(executionSummary ? { executionSummary } : {})
  };
}

function usageLabel(message: ChatMessage): string {
  const usage = message.usage;
  if (!usage) return "not reported";
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`input ${usage.inputTokens}`);
  if (usage.outputTokens !== undefined) parts.push(`output ${usage.outputTokens}`);
  if (usage.totalTokens !== undefined) parts.push(`total ${usage.totalTokens}`);
  return parts.length ? `${parts.join(" · ")} tokens` : "not reported";
}

function costCreditLabel(message: ChatMessage): string {
  const usage = message.usage;
  if (usage?.cost !== undefined) return `${usage.cost}${usage.currency ? ` ${usage.currency}` : ""}`;
  const billing = message.billing;
  if (billing?.subscriptionHarnessUsed) return "subscription harness";
  if (billing?.source) return billing.source;
  return "not reported";
}

function responseMarkdown(message: ChatMessage, session: ChatSession): string {
  const meta = explicitMetadata(message);
  const lines = [
    `# AI response`,
    "",
    `- Model: ${message.model || session.model || "not recorded"}`,
    `- Agent: ${meta.agent}`,
    `- Skills: ${meta.skills}`,
    `- Tools: ${meta.tools}`,
    `- Time: ${message.completedAt || message.createdAt}`,
    `- Usage: ${usageLabel(message)}`,
    `- Cost/Credit: ${costCreditLabel(message)}`,
    `- Status: ${message.state.toUpperCase()}`,
    ""
  ];
  if (meta.executionSummary) lines.push(`## Execution summary`, "", meta.executionSummary, "");
  lines.push("## ODPOWIEDŹ", "", message.content || "_(empty)_", "");
  return lines.join("\n");
}

function reportMarkdown(session: ChatSession, selected: SelectedChatContext, attachmentHashes: Map<string, string>): string {
  const lines = [
    `# ${sessionTitle(session)}`,
    "",
    `Session: ${session.sessionId}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "> Export contains visible response content and explicit execution metadata only. Private chain-of-thought is not exported.",
    ""
  ];
  selected.responses.forEach((message, index) => {
    lines.push("---", "", `## Response ${String(index + 1).padStart(3, "0")}`, "");
    lines.push(responseMarkdown(message, session).replace(/^# AI response\n\n/, ""));
  });
  if (selected.attachments.length) {
    lines.push("---", "", "## Selected attachments", "");
    selected.attachments.forEach(({ attachment }, index) => {
      lines.push(`${index + 1}. ${attachment.name} · ${attachment.mimeType} · ${attachment.size} bytes · ${attachmentHashes.get(attachment.id) || "hash unavailable"}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function docxBuffer(text: string): Buffer {
  const paragraphs = text.split(/\r?\n/).map((line) => {
    const safe = xmlEscape(line || " ");
    return `<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  }).join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "word/document.xml": strToU8(document)
  }, { level: 6 });
  return Buffer.from(zipped);
}

const PDF_TRANSLITERATION: Record<string, string> = {
  "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z",
  "Ą": "A", "Ć": "C", "Ę": "E", "Ł": "L", "Ń": "N", "Ó": "O", "Ś": "S", "Ź": "Z", "Ż": "Z"
};

function portablePdfText(value: string): string {
  return value.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (character) => PDF_TRANSLITERATION[character] || character)
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?");
}

function wrapLine(value: string, width = 92): string[] {
  const raw = portablePdfText(value);
  if (!raw) return [""];
  const result: string[] = [];
  let remaining = raw;
  while (remaining.length > width) {
    let split = remaining.lastIndexOf(" ", width);
    if (split < Math.floor(width * 0.55)) split = width;
    result.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  result.push(remaining);
  return result;
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function fallbackPdfBuffer(text: string): Buffer {
  const lines = text.split(/\r?\n/).flatMap((line) => wrapLine(line));
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(lines.length, 1); index += 48) pages.push(lines.slice(index, index + 48));
  if (!pages.length) pages.push([""]);

  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const instructions = ["BT", "/F1 9 Tf", "46 758 Td"];
    page.forEach((line, lineIndex) => {
      if (lineIndex > 0) instructions.push("0 -14 Td");
      instructions.push(`(${pdfEscape(line)}) Tj`);
    });
    instructions.push("ET");
    const stream = `${instructions.join("\n")}\n`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`;
  });

  let body = "%PDF-1.4\n%Koordynator\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, "ascii");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function capture(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(output));
      else rejectPromise(new Error(Buffer.concat(errors).toString("utf8") || `COMMAND_EXIT_${code}`));
    });
  });
}

async function pdfBuffer(text: string): Promise<Buffer> {
  if (process.platform === "darwin") {
    const source = join(tmpdir(), `koordynator-export-${randomUUID()}.txt`);
    try {
      await writeFile(source, text, { encoding: "utf8", mode: 0o600 });
      const rendered = await capture("cupsfilter", ["-m", "application/pdf", source]);
      if (rendered.subarray(0, 5).toString("ascii") === "%PDF-") return rendered;
    } catch {
      // Portable fallback below. It deliberately contains only visible report text.
    } finally {
      await unlink(source).catch(() => undefined);
    }
  }
  return fallbackPdfBuffer(text);
}

async function defaultLauncher(action: "open" | "reveal", target: string): Promise<void> {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = action === "reveal" ? ["-R", target] : [target];
  } else if (process.platform === "win32") {
    command = "explorer.exe";
    args = action === "reveal" ? [`/select,${target}`] : [target];
  } else {
    command = "xdg-open";
    args = [action === "reveal" ? dirname(target) : target];
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function parseReceipt(raw: string): ChatExportReceipt | null {
  try {
    const value = JSON.parse(raw) as ChatExportReceipt;
    if (!value || !EXPORT_ID_RE.test(value.exportId) || !SESSION_ID_RE.test(value.sessionId) || !Array.isArray(value.files)) return null;
    return value;
  } catch {
    return null;
  }
}

export function parseChatExportRequest(payload: Record<string, unknown>): ChatExportRequest {
  const selection = normalizeChatContextSelection(payload);
  if (typeof payload.output !== "string" || !ALLOWED_OUTPUTS.has(payload.output as ChatExportOutput)) {
    throw new ChatExportError("CHAT_EXPORT_OUTPUT_INVALID", 400);
  }
  if (!selection.responseIds.length && !selection.attachmentIds.length) {
    throw new ChatExportError("CHAT_EXPORT_SELECTION_EMPTY", 400);
  }
  return { ...selection, output: payload.output as ChatExportOutput };
}

export class ChatExportService {
  private readonly stateRoot: string;
  private readonly exportRoot: string;
  private readonly launcher: ChatExportLauncher;

  constructor(private readonly options: ChatExportServiceOptions) {
    this.stateRoot = resolve(options.stateDir, "chat-exports");
    this.exportRoot = resolve(options.exportRoot ?? join(homedir(), "Documents", "Koordynator", "Exports"));
    this.launcher = options.launcher ?? defaultLauncher;
  }

  async create(sessionId: string, request: ChatExportRequest): Promise<ChatExportReceipt> {
    const session = await this.options.chat.getSession(sessionId);
    if (!session) throw new ChatExportError("CHAT_SESSION_NOT_FOUND", 404);

    let selected: SelectedChatContext;
    try {
      selected = selectChatContext(session, request);
    } catch (error) {
      if (error instanceof ChatContextSelectionError) throw error;
      throw error;
    }

    const attachmentBytes = new Map<string, Buffer>();
    const attachmentHashes = new Map<string, string>();
    for (const { attachment } of selected.attachments) {
      const bytes = decodeAttachment(attachment);
      attachmentBytes.set(attachment.id, bytes);
      attachmentHashes.set(attachment.id, sha256(bytes));
    }

    const createdAt = new Date();
    const exportId = randomUUID();
    const projectName = safeName(sessionTitle(session), `Chat-${session.sessionId.slice(0, 8)}`);
    const directory = join(this.exportRoot, projectName, `${timestampFolder(createdAt)}-${exportId.slice(0, 8)}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const markdown = reportMarkdown(session, selected, attachmentHashes);
    const plain = markdownToPlainText(markdown);
    let renderedPdf: Buffer | undefined;
    let renderedDocx: Buffer | undefined;
    if (request.output === "pdf" || request.output === "pdf+docx" || request.output === "zip") renderedPdf = await pdfBuffer(plain);
    if (request.output === "docx" || request.output === "pdf+docx" || request.output === "zip") renderedDocx = docxBuffer(plain);

    const files: ChatExportGeneratedFile[] = [];
    const writeGenerated = async (kind: ChatExportFileKind, name: string, bytes: Buffer): Promise<void> => {
      const path = join(directory, name);
      await writeFile(path, bytes, { mode: 0o600 });
      const details = await stat(path);
      files.push({ fileId: randomUUID(), kind, name, path, size: details.size, sha256: sha256(bytes) });
    };

    if (renderedPdf) await writeGenerated("PDF", "report.pdf", renderedPdf);
    if (renderedDocx) await writeGenerated("DOCX", "report.docx", renderedDocx);

    if (request.output === "zip") {
      if (!renderedPdf || !renderedDocx) throw new ChatExportError("CHAT_EXPORT_RENDER_FAILED", 500);
      const archive: Record<string, Uint8Array> = {
        "report.pdf": renderedPdf,
        "report.docx": renderedDocx
      };
      const items: ManifestItem[] = [];
      selected.responses.forEach((message, index) => {
        const model = message.model || session.model || "model";
        const path = `responses/${String(index + 1).padStart(3, "0")}-${slug(model)}.md`;
        const body = responseMarkdown(message, session);
        archive[path] = strToU8(body);
        items.push({
          item_id: message.id,
          type: "ai_response",
          name: `Response ${String(index + 1).padStart(3, "0")}`,
          model,
          timestamp: message.completedAt || message.createdAt,
          sha256: sha256(body),
          source_session: session.sessionId,
          selected_manually: true,
          archive_path: path
        });
      });
      selected.attachments.forEach(({ attachment }, index) => {
        const path = `attachments/${String(index + 1).padStart(3, "0")}-${archiveName(attachment.name, `attachment-${index + 1}`)}`;
        const bytes = attachmentBytes.get(attachment.id)!;
        archive[path] = bytes;
        items.push({
          item_id: attachment.id,
          type: "attachment",
          name: attachment.name,
          timestamp: session.messages.find((message) => message.attachments?.some((item) => item.id === attachment.id))?.createdAt || session.createdAt,
          sha256: attachmentHashes.get(attachment.id)!,
          source_session: session.sessionId,
          selected_manually: true,
          archive_path: path
        });
      });
      const manifest = {
        schema_version: 1,
        export_id: exportId,
        source_session: session.sessionId,
        created_at: createdAt.toISOString(),
        selection: {
          response_ids: request.responseIds,
          attachment_ids: request.attachmentIds,
          selected_manually: true
        },
        privacy: {
          private_chain_of_thought_included: false,
          visible_response_content_only: true,
          explicit_execution_metadata_only: true
        },
        items,
        bundle_files: [
          { path: "report.pdf", sha256: sha256(renderedPdf) },
          { path: "report.docx", sha256: sha256(renderedDocx) }
        ]
      };
      archive["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
      const zipped = Buffer.from(zipSync(archive, { level: 6 }));
      await writeGenerated("ZIP", `${archiveName(projectName, "Koordynator")}-export.zip`, zipped);
    }

    const receipt: ChatExportReceipt = {
      exportId,
      sessionId: session.sessionId,
      createdAt: createdAt.toISOString(),
      output: request.output,
      directory,
      responseIds: [...request.responseIds],
      attachmentIds: [...request.attachmentIds],
      files
    };
    await this.persistReceipt(receipt);
    return receipt;
  }

  async listReceipts(limit = 500): Promise<ChatExportReceipt[]> {
    const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 500;
    let sessionDirs;
    try {
      sessionDirs = await readdir(this.stateRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const receipts: ChatExportReceipt[] = [];
    for (const directory of sessionDirs) {
      if (!directory.isDirectory() || !SESSION_ID_RE.test(directory.name)) continue;
      let names: string[];
      try {
        names = (await readdir(join(this.stateRoot, directory.name))).filter((name) => name.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) {
        if (receipts.length >= bounded * 2) break;
        const receipt = parseReceipt(await readFile(join(this.stateRoot, directory.name, name), "utf8").catch(() => ""));
        if (receipt) receipts.push(receipt);
      }
    }
    return receipts.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, bounded);
  }

  async action(sessionId: string, exportId: string, fileId: string, action: "open" | "reveal"): Promise<{ ok: true; path: string }> {
    if (!SESSION_ID_RE.test(sessionId) || !EXPORT_ID_RE.test(exportId) || !EXPORT_ID_RE.test(fileId)) {
      throw new ChatExportError("CHAT_EXPORT_ACTION_INVALID", 400);
    }
    if (action !== "open" && action !== "reveal") throw new ChatExportError("CHAT_EXPORT_ACTION_INVALID", 400);
    const receipt = await this.loadReceipt(sessionId, exportId);
    if (!receipt) throw new ChatExportError("CHAT_EXPORT_NOT_FOUND", 404);
    const file = receipt.files.find((item) => item.fileId === fileId);
    if (!file) throw new ChatExportError("CHAT_EXPORT_FILE_NOT_FOUND", 404);
    const resolved = resolve(file.path);
    const root = resolve(this.exportRoot);
    if (resolved !== root && !resolved.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new ChatExportError("CHAT_EXPORT_PATH_INVALID", 400);
    }
    await stat(resolved).catch(() => { throw new ChatExportError("CHAT_EXPORT_FILE_NOT_FOUND", 404); });
    try {
      await this.launcher(action, resolved);
    } catch {
      throw new ChatExportError("CHAT_EXPORT_OPEN_FAILED", 500);
    }
    return { ok: true, path: resolved };
  }

  private async persistReceipt(receipt: ChatExportReceipt): Promise<void> {
    const directory = join(this.stateRoot, receipt.sessionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${receipt.exportId}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async loadReceipt(sessionId: string, exportId: string): Promise<ChatExportReceipt | null> {
    try {
      return parseReceipt(await readFile(join(this.stateRoot, sessionId, `${exportId}.json`), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
