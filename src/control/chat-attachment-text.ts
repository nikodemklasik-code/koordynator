import { spawn } from "node:child_process";

export type ExtractableAttachment = {
  name: string;
  mimeType: string;
  bytes: Buffer;
};

function runPythonExtract(code: string, input: Buffer, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("python3", ["-c", code], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || "en_US.UTF-8" }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("ATTACHMENT_TEXT_TIMEOUT"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `ATTACHMENT_TEXT_EXIT_${code ?? 1}`));
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

function crudePdfLiterals(bytes: Buffer): string {
  const text = bytes.toString("latin1");
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const raw = match[0].slice(1, -1);
    if (!raw.trim()) continue;
    const decoded = raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(decoded)) chunks.push(decoded);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

async function extractPdf(bytes: Buffer): Promise<string | null> {
  try {
    const extracted = await runPythonExtract(
      [
        "import sys",
        "from io import BytesIO",
        "from pypdf import PdfReader",
        "data = sys.stdin.buffer.read()",
        "reader = PdfReader(BytesIO(data))",
        "parts = []",
        "for page in reader.pages:",
        "    text = page.extract_text() or ''",
        "    if text.strip(): parts.append(text)",
        "sys.stdout.write('\\n\\n'.join(parts))",
      ].join("\n"),
      bytes
    );
    const cleaned = extracted.replace(/\u0000/g, "").trim();
    if (cleaned) return cleaned.slice(0, 200_000);
  } catch {
    // fall through to crude extractor
  }
  const crude = crudePdfLiterals(bytes);
  return crude ? crude.slice(0, 200_000) : null;
}

async function extractDocx(bytes: Buffer): Promise<string | null> {
  try {
    const extracted = await runPythonExtract(
      [
        "import sys, zipfile, re",
        "from io import BytesIO",
        "from xml.etree import ElementTree as ET",
        "data = sys.stdin.buffer.read()",
        "with zipfile.ZipFile(BytesIO(data)) as zf:",
        "    xml = zf.read('word/document.xml')",
        "root = ET.fromstring(xml)",
        "texts = [node.text for node in root.iter() if node.text]",
        "sys.stdout.write('\\n'.join(t for t in texts if t and t.strip()))",
      ].join("\n"),
      bytes
    );
    const cleaned = extracted.replace(/\u0000/g, "").trim();
    return cleaned ? cleaned.slice(0, 200_000) : null;
  } catch {
    return null;
  }
}

export async function extractChatAttachmentText(attachment: ExtractableAttachment): Promise<string | null> {
  const mime = attachment.mimeType.toLowerCase();
  const name = attachment.name.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return extractPdf(attachment.bytes);
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || name.endsWith(".docx")
  ) {
    return extractDocx(attachment.bytes);
  }
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "text/xml") {
    return attachment.bytes.toString("utf8").slice(0, 200_000);
  }
  return null;
}
