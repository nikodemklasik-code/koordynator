import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Control frontend runtime truth", () => {
  it("reconciles the model picker against live OmniRoute health instead of trusting stale catalog/session state", async () => {
    const source = await readFile(new URL("../web/control/chat-usage.js", import.meta.url), "utf8");

    expect(source).toContain('/api/providers${force ? "?refresh=1" : ""}');
    expect(source).toContain("providers.omniRoutes");
    expect(source).toContain('route.health === "HEALTHY"');
    expect(source).toContain('route.health === "RATE_LIMITED"');
    expect(source).toContain("option.disabled = route.health !== \"HEALTHY\" || !exact");
    expect(source).toContain('runtimeModelSelect.dispatchEvent(new Event("change"');
    expect(source).toContain("runtimeRouteBadge");
  });

  it("surfaces audited no-login routes and preserves strict billing provenance", async () => {
    const source = await readFile(new URL("../web/control/chat-usage.js", import.meta.url), "utf8");

    for (const prefix of ["oc/", "ddgw/", "unc/", "horde/"]) expect(source).toContain(`\"${prefix}\"`);
    expect(source).toContain('runtimeModelSelect.dataset.billingSource = "FREE_CONFIRMED"');
    expect(source).toContain('runtimeModelSelect.dataset.billingAllowed = "true"');
    expect(source).not.toContain("allowPaidApi");
  });

  it("replaces the useless live Generation failed label with the actual chat error", async () => {
    const source = await readFile(new URL("../web/control/chat-usage.js", import.meta.url), "utf8");

    expect(source).toContain("annotateLatestGenerationError");
    expect(source).toContain('status.textContent = text');
    expect(source).toContain('status.className = "message-state error"');
    expect(source).toContain("streaming?.remove()");
  });

  it("keeps the Releases heading out of the KPI cards on flex layouts", async () => {
    const css = await readFile(new URL("../web/control/releases.css", import.meta.url), "utf8");

    expect(css).toContain(".page-head.release-head{flex:0 0 auto");
    expect(css).toContain(".release-kpis{flex:0 0 auto;position:relative;z-index:1}");
    expect(css).toContain("z-index:2");
  });

  it("styles live, quota and degraded runtime route badges", async () => {
    const css = await readFile(new URL("../web/control/chat-usage.css", import.meta.url), "utf8");

    expect(css).toContain(".runtime-route-badge.live");
    expect(css).toContain(".runtime-route-badge.rate_limited");
    expect(css).toContain(".runtime-route-badge.degraded");
  });
});
