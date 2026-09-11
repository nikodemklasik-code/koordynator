import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractChatAttachmentText } from "../src/control/chat-attachment-text.js";

describe("chat attachment text extraction", () => {
  it("extracts readable text from a PDF attachment buffer", async () => {
    const pdf = await readFile(resolve("tests/fixtures/hello-koordynator.pdf"));
    const text = await extractChatAttachmentText({
      name: "hello-koordynator.pdf",
      mimeType: "application/pdf",
      bytes: pdf
    });
    expect(text).toMatch(/Hello Koordynator/i);
  });

  it("returns null for unsupported binary types instead of crashing", async () => {
    const text = await extractChatAttachmentText({
      name: "photo.png",
      mimeType: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
    });
    expect(text).toBeNull();
  });
});
