import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("one-click start all", () => {
  it("ships a repo launcher script and npm alias that boots OmniRoute + AI + Control", () => {
    const script = resolve("scripts/start-all.mjs");
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(existsSync(script)).toBe(true);
    const source = readFileSync(script, "utf8");
    expect(source).toContain("ai:always-on");
    expect(source).toContain("omniroute");
    expect(source).toMatch(/8787|control|npm start|npm run control/);
    expect(source).toContain("open");
    expect(pkg.scripts?.["start:all"]).toMatch(/scripts\/start-all\.mjs/);
  });

  it("ships a Desktop .command launcher for double-click start", () => {
    const command = resolve("scripts/Koordynator-Start.command");
    expect(existsSync(command)).toBe(true);
    const source = readFileSync(command, "utf8");
    expect(source).toContain("npm run start:all");
    expect(source.startsWith("#!")).toBe(true);
  });
});
