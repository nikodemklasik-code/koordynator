import { describe, expect, it } from "vitest";
import { resolveVaultOnlySecret, type VaultKvClient } from "../src/security/vault-secret-source.js";

describe("Vault-only secret source", () => {
  it("returns the field from Vault and never falls back to env, keychain or a file", async () => {
    const calls: string[] = [];
    const vault: VaultKvClient = {
      async kvGet(path, field) {
        calls.push(`${path}:${field}`);
        return "lease-token";
      }
    };
    const secret = await resolveVaultOnlySecret({
      vault,
      path: "secret/apps/shared",
      field: "OPENAI_API_KEY",
      fallbacks: {
        env: "env-secret",
        keychain: () => "keychain-secret",
        file: () => "file-secret"
      }
    });
    expect(secret).toBe("lease-token");
    expect(calls).toEqual(["secret/apps/shared:OPENAI_API_KEY"]);
  });

  it("fails closed when Vault is sealed, denied or missing — no local fallback", async () => {
    for (const error of ["VAULT_SEALED", "VAULT_PERMISSION_DENIED", "VAULT_PATH_MISSING"]) {
      const vault: VaultKvClient = {
        async kvGet() { throw new Error(error); }
      };
      await expect(resolveVaultOnlySecret({
        vault,
        path: "secret/apps/shared",
        field: "OPENAI_API_KEY",
        fallbacks: {
          env: "env-secret",
          keychain: () => "keychain-secret",
          file: () => "file-secret"
        }
      })).rejects.toThrow(/VAULT_UNAVAILABLE|VAULT_SEALED|VAULT_PERMISSION_DENIED|VAULT_PATH_MISSING/);
    }
  });

  it("rejects a root token in runtime", async () => {
    await expect(resolveVaultOnlySecret({
      vault: { async kvGet() { return "x"; } },
      path: "secret/apps/shared",
      field: "OPENAI_API_KEY",
      tokenKind: "root"
    })).rejects.toThrow(/VAULT_ROOT_TOKEN_FORBIDDEN/);
  });
});
