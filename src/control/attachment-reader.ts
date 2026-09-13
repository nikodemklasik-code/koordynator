import { Worker } from "node:worker_threads";
import type { ExtractedAttachment } from "./attachment-extractor.js";
export function readAttachment(bytes: Uint8Array, name: string, mime: string): Promise<ExtractedAttachment> {
  return new Promise((accept, reject) => {
    const worker = new Worker(new URL("../../dist/control/attachment-extractor-worker.js", import.meta.url), {
      workerData: { bytes, name, mime }, resourceLimits: { maxOldGenerationSizeMb: 512 }, stdout: true, stderr: true
    });
    worker.stdout?.resume(); worker.stderr?.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("CHAT_ATTACHMENT_PARSE_TIMEOUT")); }, 90_000);
    worker.once("message", (data: { result?: ExtractedAttachment; error?: string }) => {
      clearTimeout(timer); void worker.terminate();
      if (data.result) accept(data.result); else reject(new Error(data.error ?? "CHAT_ATTACHMENT_PARSE_FAILED"));
    });
    worker.once("error", () => { clearTimeout(timer); reject(new Error("CHAT_ATTACHMENT_PARSE_FAILED")); });
    worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error("CHAT_ATTACHMENT_PARSE_FAILED")); });
  });
}
