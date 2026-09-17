import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("large chat upload patcher", () => {
  it("self-tests every target replacement and idempotency", async () => {
    const { stdout } = await execFileAsync(process.execPath, [resolve("scripts/apply-large-chat-upload.mjs"), "--self-test"], {
      cwd: process.cwd(),
      timeout: 15_000
    });
    expect(stdout).toContain("LARGE_CHAT_UPLOAD_SELF_TEST=PASS");
  });
});
