import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Materialisation & Release dashboard", () => {
  it("shows readiness lamps, creative spectrum and real route matrix without removing release truth", async () => {
    const [html, css, js] = await Promise.all([
      readFile(new URL("../web/control/releases.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/releases.css", import.meta.url), "utf8"),
      readFile(new URL("../web/control/releases.js", import.meta.url), "utf8")
    ]);

    expect(html).toContain("MATERIALISATION & RELEASE CONTROL");
    expect(html).toContain('id="creativeSpectrum"');
    expect(html).toContain('id="agentReadinessGrid"');
    expect(html).toContain('id="routeMatrix"');
    expect(html).toContain("Poznawanie");
    expect(html).toContain("Tworzenie");
    expect(html).toContain("Weryfikacja");
    expect(html).toContain("CURRENT PRODUCTION");
    expect(html).toContain("Release ledger");
    expect(html).toContain("Rollback chain");

    expect(css).toContain("--creative-progress");
    expect(css).toContain("linear-gradient(90deg,#f7fbff");
    expect(css).toContain(".lamp.green");
    expect(css).toContain(".lamp.amber");
    expect(css).toContain(".lamp.red");

    expect(js).toContain("/api/readiness/materialisation?refresh=1");
    expect(js).toContain("/api/providers?refresh=1");
    expect(js).toContain("fail closed");
  });
});