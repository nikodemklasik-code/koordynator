import { parentPort, workerData } from "node:worker_threads";
import { extractAttachment } from "./attachment-extractor.js";
try { parentPort?.postMessage({ result: await extractAttachment(workerData.bytes, workerData.name, workerData.mime) }); }
catch (error) {
  const code = error instanceof Error && /^CHAT_[A-Z_]+$/.test(error.message) ? error.message : "CHAT_ATTACHMENT_PARSE_FAILED";
  parentPort?.postMessage({ error: code });
}
