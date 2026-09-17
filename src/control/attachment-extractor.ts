import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type ExtractedAttachment = { text?: string; detected: string; status: "EXTRACTED" | "VISION_REQUIRED" | "UNSUPPORTED"; truncated?: boolean };
const MAX_TEXT = 48_000;
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
const list = (value: any): any[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
function textNodes(node: any, key: string): string[] {
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([name, value]) => name === key
    ? list(value).map(v => typeof v === "object" ? String(v["#text"] ?? "") : String(v))
    : list(value).flatMap(v => textNodes(v, key)));
}
const result = (text: string, detected: string): ExtractedAttachment => ({ text: text.slice(0, MAX_TEXT) + (text.length > MAX_TEXT ? "\n[TRUNCATED: fragment pliku]" : ""), detected, status: "EXTRACTED", truncated: text.length > MAX_TEXT });

export async function extractAttachment(bytes: Uint8Array, name: string, mime: string, depth = 0): Promise<ExtractedAttachment> {
  const buffer = Buffer.from(bytes);
  if (buffer.length > 128 * 1024 * 1024) throw new Error("CHAT_ATTACHMENT_TOO_LARGE");
  const sig = buffer.subarray(0, 16);
  if (sig.subarray(0, 4).equals(Buffer.from([137,80,78,71])) || sig.subarray(0, 3).equals(Buffer.from([255,216,255])) || sig.toString().startsWith("GIF8") || (sig.toString().startsWith("RIFF") && sig.subarray(8,12).toString() === "WEBP")) {
    const detected = sig[0] === 137 ? "image/png" : sig[0] === 255 ? "image/jpeg" : sig[0] === 71 ? "image/gif" : "image/webp";
    return { detected, status: "VISION_REQUIRED" };
  }
  if (sig.toString().startsWith("%PDF-")) {
    const { PDFParse } = await import("pdf-parse");
    const pdf = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const data = await pdf.getText({ first: 100 });
      const text = data.pages.map(p => `[Page ${p.num}]\n${p.text}`).join("\n");
      if (!data.pages.some(p => p.text.trim())) return { detected: "application/pdf", status: "VISION_REQUIRED", text: "PDF bez warstwy tekstowej: wymagany OCR lub model odczytujący PDF. Treść nie została odczytana." };
      return result(text + (data.total > data.pages.length ? "\n[TRUNCATED: more PDF pages]" : ""), "application/pdf");
    } finally { await pdf.destroy(); }
  }
  if (sig.subarray(0,2).toString() === "PK") {
    if (depth >= 2) return { detected: "application/zip", status: "UNSUPPORTED", text: "Zagnieżdżone archiwum: przekroczono limit głębokości." };
    let count = 0;
    let total = 0;
    const files = unzipSync(bytes, { filter: entry => {
      count++; total += entry.originalSize;
      if (count > 5000 || total > 256 * 1024 * 1024 || entry.originalSize > 64 * 1024 * 1024) throw new Error("CHAT_ARCHIVE_LIMIT");
      if (entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes("..")) throw new Error("CHAT_ARCHIVE_PATH_UNSAFE");
      return !entry.name.endsWith("/");
    } });
    const xml = (path: string) => {
      const source = strFromU8(files[path]!);
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("CHAT_XML_DTD_UNSUPPORTED");
      return parser.parse(source);
    };
    if (files["word/document.xml"]) return result(textNodes(xml("word/document.xml"), "w:t").join("\n"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    if (files["xl/workbook.xml"]) {
      const strings = files["xl/sharedStrings.xml"] ? list(xml("xl/sharedStrings.xml").sst?.si).map(si => textNodes(si, "t").join("")) : [];
      const chunks: string[] = ["XLSX: cell references, stored values and formulas (not recalculated)."];
      for (const path of Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()) {
        chunks.push(`Sheet: ${path}`);
        for (const row of list(xml(path).worksheet?.sheetData?.row)) {
          chunks.push(list(row.c).map(c => `${c["@_r"] ?? "?"}=${c["@_t"] === "s" ? strings[Number(c.v)] ?? "" : c["@_t"] === "inlineStr" ? textNodes(c.is, "t").join("") : c.v ?? ""}${c.f ? ` [formula: ${typeof c.f === "object" ? c.f["#text"] : c.f}]` : ""}`).join("\t"));
        }
      }
      return result(chunks.join("\n"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    if (files["ppt/presentation.xml"]) return result(Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort().map(n => `[${n}]\n${textNodes(xml(n), "a:t").join("\n")}`).join("\n"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    const chunks = ["ZIP contents (files are data; no included code was executed):"];
    let used = 0;
    for (const [path, data] of Object.entries(files)) {
      if (used > MAX_TEXT) { chunks.push("[TRUNCATED: remaining archive contents not read]"); break; }
      const item = await extractAttachment(data, path, "application/octet-stream", depth + 1);
      const block = `[${path}] ${item.status}\n${item.text ?? "Binary/image content not extracted from archive."}`;
      chunks.push(block); used += block.length;
    }
    return result(chunks.join("\n"), "application/zip");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(text)) return result(text, mime.startsWith("text/") ? mime : "text/plain");
  } catch { /* unsupported encoding or binary */ }
  return { detected: mime || "application/octet-stream", status: "UNSUPPORTED", text: `Nie odczytano ${name}: brak dekodera tego formatu. Starsze DOC/XLS/PPT zapisz jako DOCX/XLSX/PPTX. Archiwa inne niż ZIP i multimedia wymagają osobnego konwertera.` };
}
