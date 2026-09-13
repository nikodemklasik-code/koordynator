#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

export const LARGE_CHAT_UPLOAD_LIMITS = Object.freeze({
  maxAttachmentBytes: 128 * 1024 * 1024,
  maxAttachmentTotalBytes: 192 * 1024 * 1024,
  maxHistoryAttachmentBytes: 224 * 1024 * 1024,
  maxHttpBodyBytes: 272 * 1024 * 1024,
  maxArchiveEntries: 5000,
  maxArchiveExpandedBytes: 256 * 1024 * 1024,
  maxArchiveEntryBytes: 64 * 1024 * 1024,
  workerOldGenerationMb: 512,
  workerTimeoutMs: 90_000
});

const replacements = new Map([
  ["web/control/chat.js", [
    ["const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;", "const MAX_ATTACHMENT_BYTES = 128 * 1024 * 1024;"],
    ["const MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;", "const MAX_ATTACHMENT_TOTAL_BYTES = 192 * 1024 * 1024;"],
    ["showAttachmentError(`${file.name} is larger than 10 MB.`);", "showAttachmentError(`${file.name} is larger than 128 MB.`);"],
    ["showAttachmentError(\"Attachments exceed the 20 MB total limit.\");", "showAttachmentError(\"Attachments exceed the 192 MB total limit.\");"]
  ]],
  ["src/control/server.ts", [
    ["const CHAT_MESSAGE_MAX_BYTES = 21 * 1024 * 1024;", "const CHAT_MESSAGE_MAX_BYTES = 272 * 1024 * 1024;"]
  ]],
  ["src/control/chat-service.ts", [
    ["this.maxAttachmentBytes = options.maxAttachmentBytes ?? 10 * 1024 * 1024;", "this.maxAttachmentBytes = options.maxAttachmentBytes ?? 128 * 1024 * 1024;"],
    ["this.maxAttachmentTotalBytes = options.maxAttachmentTotalBytes ?? 20 * 1024 * 1024;", "this.maxAttachmentTotalBytes = options.maxAttachmentTotalBytes ?? 192 * 1024 * 1024;"],
    ["this.maxHistoryAttachmentBytes = options.maxHistoryAttachmentBytes ?? 24 * 1024 * 1024;", "this.maxHistoryAttachmentBytes = options.maxHistoryAttachmentBytes ?? 224 * 1024 * 1024;"]
  ]],
  ["src/control/attachment-extractor.ts", [
    ["if (buffer.length > 10 * 1024 * 1024) throw new Error(\"CHAT_ATTACHMENT_TOO_LARGE\");", "if (buffer.length > 128 * 1024 * 1024) throw new Error(\"CHAT_ATTACHMENT_TOO_LARGE\");"],
    ["if (count > 300 || total > 20 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024) throw new Error(\"CHAT_ARCHIVE_LIMIT\");", "if (count > 5000 || total > 256 * 1024 * 1024 || entry.originalSize > 64 * 1024 * 1024) throw new Error(\"CHAT_ARCHIVE_LIMIT\");"]
  ]],
  ["src/control/attachment-reader.ts", [
    ["resourceLimits: { maxOldGenerationSizeMb: 192 }", "resourceLimits: { maxOldGenerationSizeMb: 512 }"],
    ["}, 20_000);", "}, 90_000);"]
  ]],
  ["tests/attachment-extractor.test.ts", [
    ["new Uint8Array(11 * 1024 * 1024)", "new Uint8Array(65 * 1024 * 1024)"],
    [
      "expect(read.text).toContain(\"read this\"); expect(read.text).toContain(\"UNSUPPORTED\");",
      "expect(read.text).toContain(\"read this\"); expect(read.text).toContain(\"UNSUPPORTED\");\n    const manyEntries = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`src/file-${i}.ts`, strToU8(`export const v${i} = ${i};`)]));\n    expect((await extractAttachment(zipSync(manyEntries),\"many.zip\",\"application/zip\")).text).toContain(\"src/file-0.ts\");"
    ]
  ]]
]);

function replaceExact(path, source, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`PATCH_MARKER_MISSING ${path}: ${from.slice(0, 80)}`);
  return source.replace(from, to);
}

export function patchLargeChatUploadSource(path, source) {
  const set = replacements.get(path);
  if (!set) throw new Error(`PATCH_TARGET_UNKNOWN ${path}`);
  return set.reduce((text, [from, to]) => replaceExact(path, text, from, to), source);
}

async function patchRepository(root = process.cwd()) {
  const changed = [];
  for (const path of replacements.keys()) {
    const absolute = resolve(root, path);
    const before = await readFile(absolute, "utf8");
    const after = patchLargeChatUploadSource(path, before);
    if (after !== before) {
      await writeFile(absolute, after, "utf8");
      changed.push(path);
    }
  }
  console.log(`LARGE_CHAT_UPLOAD=PASS max_file=128MB max_total=192MB zip_entries=5000 zip_expanded=256MB zip_entry=64MB http_body=272MB worker=512MB/90s`);
  console.log(`PATCHED=${changed.length ? changed.join(",") : "already-applied"}`);
}

function selfTest() {
  const fixtures = {
    "web/control/chat.js": "const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;\nconst MAX_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;\nshowAttachmentError(`${file.name} is larger than 10 MB.`);\nshowAttachmentError(\"Attachments exceed the 20 MB total limit.\");",
    "src/control/server.ts": "const CHAT_MESSAGE_MAX_BYTES = 21 * 1024 * 1024;",
    "src/control/chat-service.ts": "this.maxAttachmentBytes = options.maxAttachmentBytes ?? 10 * 1024 * 1024;\nthis.maxAttachmentTotalBytes = options.maxAttachmentTotalBytes ?? 20 * 1024 * 1024;\nthis.maxHistoryAttachmentBytes = options.maxHistoryAttachmentBytes ?? 24 * 1024 * 1024;",
    "src/control/attachment-extractor.ts": "if (buffer.length > 10 * 1024 * 1024) throw new Error(\"CHAT_ATTACHMENT_TOO_LARGE\");\nif (count > 300 || total > 20 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024) throw new Error(\"CHAT_ARCHIVE_LIMIT\");",
    "src/control/attachment-reader.ts": "resourceLimits: { maxOldGenerationSizeMb: 192 }\nconst timer = setTimeout(() => {}, 20_000);",
    "tests/attachment-extractor.test.ts": "expect(read.text).toContain(\"read this\"); expect(read.text).toContain(\"UNSUPPORTED\");\nnew Uint8Array(11 * 1024 * 1024)"
  };
  for (const [path, source] of Object.entries(fixtures)) {
    const once = patchLargeChatUploadSource(path, source);
    const twice = patchLargeChatUploadSource(path, once);
    if (once !== twice) throw new Error(`PATCH_NOT_IDEMPOTENT ${path}`);
  }
  console.log("LARGE_CHAT_UPLOAD_SELF_TEST=PASS");
}

if (process.argv.includes("--self-test")) selfTest();
else await patchRepository();
