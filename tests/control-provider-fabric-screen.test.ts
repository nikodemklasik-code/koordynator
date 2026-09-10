import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const knownHealth = new Set(["HEALTHY", "DEGRADED", "RATE_LIMITED", "UNAVAILABLE", "AUTH_REQUIRED", "BLOCKED", "QUARANTINED"]);

describe("Control Provider Fabric screen", () => {
  it("projects official providers, visible actions, natural page scrolling and billing provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-providers-"));
    const server = createControlServer({ stateDir: root, webRoot: join(process.cwd(), "web", "control"), environment: "TEST", version: "0.2.0" });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("CONTROL_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${base}/api/providers`);
      expect(response.status).toBe(200);
      const fabric = await response.json();
      expect(fabric.mode).toBe("OFFICIAL_CLI");
      expect(fabric.providers.map((item: { providerId: string }) => item.providerId)).toEqual([
        "openai-codex-sub", "claude-code-sub", "gemini-cli-sub", "github-copilot-sub"
      ]);
      for (const provider of fabric.providers) {
        expect(provider.descriptor.transport).toBe("OFFICIAL_CLI");
        expect(provider.descriptor.accessMode).toBe("SUBSCRIPTION");
        expect(provider.descriptor.billingMode).toBe("SUBSCRIPTION_INCLUDED");
        expect(knownHealth.has(provider.health)).toBe(true);
        expect(provider.connectCommand).toBe(`orchestrator provider connect ${provider.providerId}`);
      }
      expect(fabric.architecture.failoverRule).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(fabric.architecture.credentialRule).toBe("NO_BROWSER_PASSWORD_OR_COOKIE_CAPTURE");

      const doctor = await fetch(`${base}/api/providers/openai-codex-sub/doctor`);
      expect(doctor.status).toBe(200);
      const doctorPayload = await doctor.json();
      expect(doctorPayload.providerId).toBe("openai-codex-sub");
      expect(knownHealth.has(doctorPayload.health)).toBe(true);

      const page = await fetch(`${base}/providers`).then((item) => item.text());
      expect(page).toContain("OFFICIAL CLI PROVIDERS");
      expect(page).toContain("FABRIC ARCHITECTURE");
      expect(page).toContain("No password or cookie capture");
      expect(page).not.toContain('type="password"');

      const cssResponse = await fetch(`${base}/providers.css`);
      expect(cssResponse.status).toBe(200);
      const css = await cssResponse.text();
      expect(css).toMatch(/body\s*\{[^}]*overflow-x:hidden[^}]*overflow-y:auto/s);
      expect(css).toMatch(/\.provider-sidebar\s*\{[^}]*position:sticky/s);
      expect(css).toMatch(/\.provider-content\s*\{[^}]*overflow:visible/s);
      expect(css).toMatch(/\.provider-rows\s*\{[^}]*overflow:visible/s);
      expect(css).toMatch(/\.receipt-rows\s*\{[^}]*overflow:visible/s);
      expect(css).toMatch(/\.provider-actions\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
      expect(css).toContain("@media (max-width:1500px)");
      expect(css).not.toContain("margin-top:-35vh");
      expect(css).not.toMatch(/\.provider-row\s*\{[^}]*min-width:720px/s);

      const js = await fetch(`${base}/providers.js`).then((item) => item.text());
      expect(js).toContain("SUBSCRIPTION-HARNESS");
      expect(js).toContain("PAID-API");
      expect(js).toContain('data-label="ACTIONS"');

      const denied = await fetch(`${base}/api/providers`, { method: "POST" });
      expect(denied.status).toBe(405);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
