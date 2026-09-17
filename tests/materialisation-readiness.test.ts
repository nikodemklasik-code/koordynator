import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMaterialisationReadiness } from "../src/control/materialisation-readiness.js";
import type { OmniRouteLiveStatus } from "../src/control/omniroute-live-status.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function executablePath(...names: string[]): Promise<{ root: string; bin: string }> {
  const root = await mkdtemp(join(tmpdir(), "readiness-"));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  for (const name of names) {
    const path = join(bin, name);
    await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(path, 0o755);
  }
  return { root, bin };
}

function route(health: OmniRouteLiveStatus["health"] = "HEALTHY"): OmniRouteLiveStatus {
  return {
    providerId: "omni-opencode-free",
    family: "opencode-free",
    label: "OpenCode Free",
    model: "oc/big-pickle",
    health,
    transport: "OMNIROUTE",
    connectAction: health === "HEALTHY" ? "READY" : "RETRY",
    doctorCommand: "doctor",
    connectCommand: "connect",
    detail: health === "HEALTHY" ? "Live inference probe passed" : "unavailable",
    checkedAt: new Date().toISOString()
  };
}

describe("materialisation readiness", () => {
  it("separates materialisation readiness from full audit/deploy pipeline readiness", async () => {
    const { root, bin } = await executablePath("hermes", "opencode", "playwright", "npx");
    const result = await buildMaterialisationReadiness({
      projectRoot: root,
      materialisationEnabled: true,
      primaryModel: "oc/big-pickle",
      fallbackModels: ["gc/grok-4.6"],
      routes: [route("HEALTHY")],
      hermesGrant: { terminal: true, updatedAt: new Date().toISOString() },
      path: bin
    });

    expect(result.canMaterialise).toBe(true);
    expect(result.fullPipelineReady).toBe(false);
    expect(result.overall).toBe("AMBER");
    expect(result.healthyAiRoutes).toBe(1);
    expect(result.stages.find((stage) => stage.id === "harmonia")?.light).toBe("GREEN");
    expect(result.stages.find((stage) => stage.id === "research")?.light).toBe("GREEN");
    expect(result.stages.find((stage) => stage.id === "build")?.light).toBe("GREEN");
    expect(result.stages.find((stage) => stage.id === "browser")?.light).toBe("GREEN");
    expect(result.stages.find((stage) => stage.id === "audit")?.light).toBe("RED");
    expect(result.stages.find((stage) => stage.id === "deploy")?.light).toBe("RED");
  });

  it("fails closed when there is no executable AI route", async () => {
    const { root, bin } = await executablePath("hermes", "opencode", "playwright", "npx");
    const result = await buildMaterialisationReadiness({
      projectRoot: root,
      materialisationEnabled: true,
      primaryModel: "oc/big-pickle",
      fallbackModels: [],
      routes: [route("UNAVAILABLE")],
      hermesGrant: { terminal: false, updatedAt: null },
      path: bin
    });

    expect(result.canMaterialise).toBe(false);
    expect(result.overall).toBe("RED");
    expect(result.stages.find((stage) => stage.id === "harmonia")?.light).toBe("RED");
    expect(result.stages.find((stage) => stage.id === "build")?.light).toBe("RED");
  });

  it("reports a missing materialisation signing key as a blocking red gate", async () => {
    const { root, bin } = await executablePath("hermes", "opencode", "playwright", "npx");
    const result = await buildMaterialisationReadiness({
      projectRoot: root,
      materialisationEnabled: false,
      routes: [route("HEALTHY")],
      hermesGrant: { terminal: true, updatedAt: new Date().toISOString() },
      path: bin
    });

    expect(result.canMaterialise).toBe(false);
    expect(result.stages[0]?.id).toBe("signing");
    expect(result.stages[0]?.light).toBe("RED");
  });
});