import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { ChatExportService, parseChatExportRequest } from "../src/control/chat-export-service.js";
import { ChatService, type ChatSession } from "../src/control/chat-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function seededChat() {
  const root = await mkdtemp(join(tmpdir(), "koordynator-chat-export-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const exportRoot = join(root, "exports");
  await mkdir(join(stateDir, "chat"), { recursive: true });

  const sessionId = "11111111-1111-4111-8111-111111111111";
  const responseId = "22222222-2222-4222-8222-222222222222";
  const attachmentId = "33333333-3333-4333-8333-333333333333";
  const attachmentBytes = Buffer.from("canonical architecture\n", "utf8");
  const session: ChatSession = {
    sessionId,
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:02:00.000Z",
    model: "openai/gpt-5.6-sol",
    messages: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        sessionId,
        role: "user",
        content: "Harmony VERA export",
        createdAt: "2026-09-13T00:00:00.000Z",
        state: "complete",
        attachments: [{
          id: attachmentId,
          name: "architecture.pdf",
          mimeType: "application/pdf",
          size: attachmentBytes.length,
          dataUrl: `data:application/pdf;base64,${attachmentBytes.toString("base64")}`
        }]
      },
      {
        id: responseId,
        sessionId,
        role: "assistant",
        content: "Visible final answer only.",
        createdAt: "2026-09-13T00:01:00.000Z",
        completedAt: "2026-09-13T00:02:00.000Z",
        state: "complete",
        model: "openai/gpt-5.6-sol",
        usage: { reportedBy: "PROVIDER", inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0, currency: "USD" }
      }
    ]
  };
  await writeFile(join(stateDir, "chat", `${sessionId}.json`), `${JSON.stringify(session, null, 2)}\n`, "utf8");
  const chat = new ChatService({ stateDir });
  return { stateDir, exportRoot, chat, sessionId, responseId, attachmentId, attachmentBytes };
}

describe("ChatExportService", () => {
  it("creates selective PDF, DOCX and ZIP artifacts with original attachments and manifest", async () => {
    const seeded = await seededChat();
    const actions: Array<{ action: string; path: string }> = [];
    const service = new ChatExportService({
      stateDir: seeded.stateDir,
      chat: seeded.chat,
      exportRoot: seeded.exportRoot,
      launcher: async (action, path) => { actions.push({ action, path }); }
    });

    const receipt = await service.create(seeded.sessionId, {
      responseIds: [seeded.responseId],
      attachmentIds: [seeded.attachmentId],
      output: "zip"
    });

    expect(receipt.files.map((file) => file.kind)).toEqual(["PDF", "DOCX", "ZIP"]);
    const pdf = receipt.files.find((file) => file.kind === "PDF")!;
    const docx = receipt.files.find((file) => file.kind === "DOCX")!;
    const zip = receipt.files.find((file) => file.kind === "ZIP")!;
    expect((await readFile(pdf.path)).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect((await readFile(docx.path)).subarray(0, 2).toString("ascii")).toBe("PK");

    const archive = unzipSync(new Uint8Array(await readFile(zip.path)));
    expect(Object.keys(archive)).toContain("report.pdf");
    expect(Object.keys(archive)).toContain("report.docx");
    expect(Object.keys(archive)).toContain("manifest.json");
    const responsePath = Object.keys(archive).find((name) => name.startsWith("responses/"));
    const attachmentPath = Object.keys(archive).find((name) => name.startsWith("attachments/"));
    expect(responsePath).toBeTruthy();
    expect(attachmentPath).toBeTruthy();
    expect(Buffer.from(archive[attachmentPath!]!).equals(seeded.attachmentBytes)).toBe(true);
    expect(Buffer.from(archive[responsePath!]!).toString("utf8")).toContain("Skills: not recorded");

    const manifest = JSON.parse(Buffer.from(archive["manifest.json"]!).toString("utf8"));
    expect(manifest.source_session).toBe(seeded.sessionId);
    expect(manifest.selection.response_ids).toEqual([seeded.responseId]);
    expect(manifest.selection.attachment_ids).toEqual([seeded.attachmentId]);
    expect(manifest.privacy.private_chain_of_thought_included).toBe(false);
    expect(manifest.items).toHaveLength(2);
    expect(manifest.items.every((item: any) => item.selected_manually === true && String(item.sha256).startsWith("sha256:"))).toBe(true);

    const listed = await service.listReceipts();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.exportId).toBe(receipt.exportId);

    await service.action(receipt.sessionId, receipt.exportId, zip.fileId, "reveal");
    expect(actions).toEqual([{ action: "reveal", path: zip.path }]);
  });

  it("rejects an empty selection at the request boundary", () => {
    expect(() => parseChatExportRequest({ responseIds: [], attachmentIds: [], output: "pdf" }))
      .toThrowError(expect.objectContaining({ code: "CHAT_EXPORT_SELECTION_EMPTY" }));
  });
});
