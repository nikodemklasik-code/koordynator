import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerPushGrantStore } from "../src/control/owner-push-grant-store.js";
import {
  assertWorkspaceRepository,
  explicitProtectedPushRequest,
  protectedBranchesForRepository,
  safeWorkspaceId
} from "../src/control/workspace-repository-policy.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace repository policy", () => {
  it("binds each product workspace to its own repository", () => {
    expect(assertWorkspaceRepository("corporation")).toBe("nikodemklasik-code/koordynator");
    expect(assertWorkspaceRepository("harmonia-legal")).toBe("nikodemklasik-code/Harmonia-Legal-Platform");
    expect(assertWorkspaceRepository("general", "nikodemklasik-code/anything")).toBe("nikodemklasik-code/anything");
    expect(() => assertWorkspaceRepository("corporation", "nikodemklasik-code/Harmonia-Legal-Platform")).toThrow("WORKSPACE_REPOSITORY_FIXED");
    expect(() => assertWorkspaceRepository("harmonia-legal", "nikodemklasik-code/koordynator")).toThrow("WORKSPACE_REPOSITORY_FIXED");
  });

  it("scopes protected push approval to the repository and branch named by the user", () => {
    expect(explicitProtectedPushRequest("proszę push", "nikodemklasik-code/Harmonia-Legal-Platform", "harmonia-legal"))
      .toEqual({ repository: "nikodemklasik-code/Harmonia-Legal-Platform", branch: "develop" });
    expect(explicitProtectedPushRequest("push main", "nikodemklasik-code/Harmonia-Legal-Platform", "harmonia-legal"))
      .toEqual({ repository: "nikodemklasik-code/Harmonia-Legal-Platform", branch: "main" });
    expect(explicitProtectedPushRequest("push", "nikodemklasik-code/koordynator", "corporation"))
      .toEqual({ repository: "nikodemklasik-code/koordynator", branch: "integration/control-corporation-v1" });
    expect(explicitProtectedPushRequest("just inspect", "nikodemklasik-code/koordynator", "corporation")).toBeNull();
    expect(protectedBranchesForRepository("nikodemklasik-code/koordynator")).toEqual(["main", "integration/control-corporation-v1"]);
    expect(protectedBranchesForRepository("nikodemklasik-code/Harmonia-Legal-Platform")).toEqual(["develop", "main"]);
    expect(safeWorkspaceId("general")).toBe("general");
    expect(() => safeWorkspaceId("other")).toThrow("WORKSPACE_INVALID");
  });

  it("stores short-lived one-shot grants without spilling into another repo or branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "owner-push-grant-"));
    roots.push(root);
    const store = new OwnerPushGrantStore(join(root, "grants.json"));
    await store.grant({ repository: "nikodemklasik-code/koordynator", branch: "main", source: "chat", ttlMs: 60_000 });
    await store.grant({ repository: "nikodemklasik-code/koordynator", branch: "legal-platform", source: "terminal", ttlMs: 60_000 });
    const grants = await store.list();
    expect(grants).toHaveLength(2);
    expect(grants.map((item) => [item.repository, item.branch])).toContainEqual(["nikodemklasik-code/koordynator", "main"]);
    expect(grants.map((item) => [item.repository, item.branch])).toContainEqual(["nikodemklasik-code/koordynator", "legal-platform"]);
  });
});
