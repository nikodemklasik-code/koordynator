import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractAttachment } from "../src/control/attachment-extractor.js";
import { readAttachment } from "../src/control/attachment-reader.js";

const archive = (files: Record<string,string>) => zipSync(Object.fromEntries(Object.entries(files).map(([n,t]) => [n,strToU8(t)])));
describe("attachment recognition and extraction", () => {
  it("reads UTF8 by content and bounds text", async () => {
    expect((await extractAttachment(strToU8("Zażółć gęślą"), "unknown.bin", "application/octet-stream")).text).toBe("Zażółć gęślą");
    expect((await extractAttachment(strToU8("a".repeat(50000)), "file.txt", "text/plain")).truncated).toBe(true);
  });
  it("extracts DOCX text, not its ZIP bytes", async () => {
    const data = archive({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Contract scope</w:t></w:r></w:p></w:body></w:document>' });
    expect((await extractAttachment(data,"file.docx","application/zip")).text).toBe("Contract scope");
  });
  it("resolves XLSX shared strings and reports stored formulas without calculating", async () => {
    const data = archive({ "xl/workbook.xml": "<workbook/>", "xl/sharedStrings.xml": '<sst><si><t>Revenue</t></si></sst>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>' });
    const read = await extractAttachment(data,"file.xlsx","application/zip");
    expect(read.text).toContain("A1=Revenue"); expect(read.text).toContain("B1=3 [formula: 1+2]");
  });
  it("lists ZIP files, flags unread binary files and never writes or executes entries", async () => {
    const data = zipSync({ "notes.txt": strToU8("read this"), "binary.exe": new Uint8Array([0,255]) });
    const read = await extractAttachment(data,"file.zip","application/zip");
    expect(read.text).toContain("read this"); expect(read.text).toContain("UNSUPPORTED");
    const manyEntries = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`src/file-${i}.ts`, strToU8(`export const v${i} = ${i};`)]));
    expect((await extractAttachment(zipSync(manyEntries),"many.zip","application/zip")).text).toContain("src/file-0.ts");
    await expect(extractAttachment(archive({ "../escape": "x" }),"bad.zip","application/zip")).rejects.toThrow("CHAT_ARCHIVE_PATH_UNSAFE");
    await expect(extractAttachment(zipSync({ "bomb.txt": new Uint8Array(65 * 1024 * 1024) }),"bad.zip","application/zip")).rejects.toThrow("CHAT_ARCHIVE_LIMIT");
  });
  it("recognizes JPG bytes despite an incorrect extension", async () => {
    expect(await extractAttachment(new Uint8Array([255,216,255,224]),"photo.txt","text/plain")).toMatchObject({ detected: "image/jpeg", status: "VISION_REQUIRED" });
  });
  it("runs the bounded worker and explicitly marks unsupported legacy Office", async () => {
    expect((await readAttachment(strToU8("worker read"),"f.txt","text/plain")).text).toBe("worker read");
    expect((await extractAttachment(new Uint8Array([0xd0,0xcf,0x11,0xe0]),"f.doc","application/msword")).status).toBe("UNSUPPORTED");
  });
  it("extracts actual PDF text in the worker and rejects malformed PDFs", async () => {
    const stream = "BT /F1 12 Tf 72 720 Td (PDF connection test) Tj ET";
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let body = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i+1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(body);
    body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,"0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const read = await readAttachment(Buffer.from(body), "actual.pdf", "application/pdf");
    expect(read.text).toContain("PDF connection test");
    await expect(readAttachment(Buffer.from("%PDF-1.4 broken"), "bad.pdf", "application/pdf")).rejects.toThrow("CHAT_ATTACHMENT_PARSE_FAILED");
  });

});
