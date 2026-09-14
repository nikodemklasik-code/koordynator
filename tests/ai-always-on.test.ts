import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ai always-on launcher", () => {
  it("does not rotate a live Hermes ticket proxy", () => {
    const source = readFileSync(resolve("scripts/ai-always-on.mjs"), "utf8");
    expect(source).toContain("firstLiveRoute");
    expect(source).toContain("liveManagedHermesProxy");
    expect(source).toContain("kept live Hermes ticket proxy; not rotated");
    expect(source).toMatch(/lsof[\s\S]*iTCP:\$\{port\}/);
  });

  it("still sees the live proxy after Hermes rewrites config.yaml as YAML", () => {
    const source = readFileSync(resolve("scripts/ai-always-on.mjs"), "utf8");
    expect(source).toContain("parseManagedHermesConfig");
    expect(source).toMatch(/api_key:\s*/);
    expect(source).toMatch(/base_url:\s*/);
    expect(source).not.toMatch(/JSON\.parse\(readFileSync\(configPath/);
  });
});
