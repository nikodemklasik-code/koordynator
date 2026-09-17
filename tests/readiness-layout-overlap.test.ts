import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Readiness page layout", () => {
  it("reserves a non-shrinking header row above KPI cards", async () => {
    const html = await readFile(new URL("../web/control/releases.html", import.meta.url), "utf8");

    expect(html).toContain('id="readiness-layout-guard"');
    expect(html).toContain(".page-head.release-head{display:grid");
    expect(html).toContain("flex:0 0 auto");
    expect(html).toContain("grid-template-columns:minmax(0,1fr) auto");
    expect(html).toContain(".readiness-kpis{flex:0 0 auto;position:relative;z-index:1");
    expect(html).toContain("@media(max-width:980px)");
  });
});
