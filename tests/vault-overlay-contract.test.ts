import { describe, expect, it } from "vitest";
import {
  VAULT_ADDR_NEW,
  VAULT_ADDR_LEGACY,
  assertAppRoleApplyApproved,
  assertSecretKey,
  assertSecretPath,
  assertVaultAddress,
  chooseVaultAuth,
  type VaultAuthEvidence
} from "../src/security/vault-overlay-contract.js";
import { resolveVaultOnlySecret } from "../src/security/vault-secret-source.js";

describe("MultivoHub Vault Overlay 0.4.0 contract", () => {
  it("pins runtime to the new Vault on 8300 and never to the sealed legacy 8200", () => {
    expect(VAULT_ADDR_NEW).toBe("http://127.0.0.1:8300");
    expect(VAULT_ADDR_LEGACY).toBe("http://127.0.0.1:8200");
    expect(() => assertVaultAddress(VAULT_ADDR_NEW)).not.toThrow();
    expect(() => assertVaultAddress("http://127.0.0.1:8300/")).not.toThrow();
    expect(() => assertVaultAddress(VAULT_ADDR_LEGACY)).toThrow(/VAULT_LEGACY_FORBIDDEN/);
    expect(() => assertVaultAddress("http://127.0.0.1:8200/v1")).toThrow(/VAULT_LEGACY_FORBIDDEN/);
    expect(() => assertVaultAddress("http://147.93.86.209:8300")).toThrow(/VAULT_ADDR_INVALID/);
  });

  it("accepts only overlay KV paths and rejects traversal or sys paths", () => {
    for (const path of [
      "secret/apps/shared",
      "secret/apps/project",
      "secret/apps/projects/harmonia-platform"
    ]) expect(() => assertSecretPath(path)).not.toThrow();

    for (const path of [
      "secret/apps/../sys",
      "sys/init",
      "secret/apps",
      "secret/apps/projects/../shared",
      "secret/apps/projects/Bad_Slug",
      "/root/vault-new-init.json"
    ]) expect(() => assertSecretPath(path)).toThrow(/VAULT_PATH_REJECTED/);
  });

  it("accepts overlay key names and rejects empty or path-like fields", () => {
    expect(() => assertSecretKey("OPENAI_API_KEY")).not.toThrow();
    expect(() => assertSecretKey("omniroute.gateway")).not.toThrow();
    expect(() => assertSecretKey("1BAD")).toThrow(/VAULT_KEY_REJECTED/);
    expect(() => assertSecretKey("../root_token")).toThrow(/VAULT_KEY_REJECTED/);
    expect(() => assertSecretKey("unseal_keys_b64")).toThrow(/VAULT_KEY_REJECTED/);
  });

  it("prefers AppRole and refuses silent root escalation when AppRole files exist but login fails", () => {
    const broken: VaultAuthEvidence = { approleFilesPresent: true, approleToken: null };
    expect(() => chooseVaultAuth(broken)).toThrow(/VAULT_APPROLE_FAILED/);

    const ok: VaultAuthEvidence = { approleFilesPresent: true, approleToken: "lease-token" };
    expect(chooseVaultAuth(ok)).toEqual({ method: "approle" });
  });

  it("does not fall back to root when AppRole has not been applied", () => {
    expect(() => chooseVaultAuth({ approleFilesPresent: false, approleToken: null, rootToken: "must-not-be-used" }))
      .toThrow(/VAULT_APPROLE_REQUIRED/);
  });

  it("blocks AppRole policy apply without the overlay approval phrase", () => {
    expect(() => assertAppRoleApplyApproved({})).toThrow(/BLOCKED_BY_APPROVAL/);
    expect(() => assertAppRoleApplyApproved({ MVH_APPROVE_APPROLE: "yes" })).toThrow(/BLOCKED_BY_APPROVAL/);
    expect(() => assertAppRoleApplyApproved({
      MVH_APPROVE_APPROLE: "I_APPROVE_LEAST_PRIVILEGE_APPROLE"
    })).not.toThrow();
  });

  it("rejects overlay-disallowed paths at the Vault-only resolver, without using fallbacks", async () => {
    const vault = {
      async kvGet() { return "should-not-run"; }
    };
    await expect(resolveVaultOnlySecret({
      vault,
      path: "sys/policy",
      field: "OPENAI_API_KEY",
      fallbacks: { env: "env-secret", keychain: () => "keychain-secret", file: () => "file-secret" }
    })).rejects.toThrow(/VAULT_PATH_REJECTED/);
  });
});
