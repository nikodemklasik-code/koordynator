export type VaultKvClient = {
  kvGet(path: string, field: string): Promise<string>;
};

export type VaultSecretRequest = {
  vault: VaultKvClient;
  path: string;
  field: string;
  tokenKind?: "approle" | "jwt" | "root";
  fallbacks?: {
    env?: string;
    keychain?: () => string;
    file?: () => string;
  };
};

export async function resolveVaultOnlySecret(request: VaultSecretRequest): Promise<string> {
  if (request.tokenKind === "root") throw new Error("VAULT_ROOT_TOKEN_FORBIDDEN");
  try {
    const value = await request.vault.kvGet(request.path, request.field);
    if (!value) throw new Error("VAULT_PATH_MISSING");
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : "VAULT_UNAVAILABLE";
    if (
      message === "VAULT_SEALED"
      || message === "VAULT_PERMISSION_DENIED"
      || message === "VAULT_PATH_MISSING"
      || message === "VAULT_UNAVAILABLE"
    ) {
      throw new Error(message);
    }
    throw new Error("VAULT_UNAVAILABLE");
  }
}
