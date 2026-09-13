import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareHermes } from "../src/runtime/hermes-launch.js";

describe("Hermes managed task ticket lifetime", () => {
  it("keeps one interactive Hermes session valid beyond the old 30 minute cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-ticket-"));
    let launch: Awaited<ReturnType<typeof prepareHermes>> | undefined;
    try {
      launch = await prepareHermes(
        { endpoint: "http://127.0.0.1:20128/v1", apiKey: "test-gateway-key", model: "cx/gpt-test" },
        root,
        { KOORDYNATOR_FALLBACK_MODELS: "" } as NodeJS.ProcessEnv
      );
      const token = String(launch.env.OMNIROUTE_TASK_TICKET || "");
      const payload = token.split(".")[1];
      expect(payload).toBeTruthy();
      const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as { iat: number; exp: number };
      expect(claims.exp - claims.iat).toBe(24 * 60 * 60_000);
      expect(claims.exp - claims.iat).toBeGreaterThan(30 * 60_000);
    } finally {
      await launch?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
