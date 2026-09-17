export const VAULT_ADDR_NEW = "http://127.0.0.1:8300";
export const VAULT_ADDR_LEGACY = "http://127.0.0.1:8200";
export const APPROLE_APPROVAL = "I_APPROVE_LEAST_PRIVILEGE_APPROLE";

const PATH_RE = /^secret\/apps\/(?:shared|project|projects\/[a-z0-9][a-z0-9-]{0,63})$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/;
const FORBIDDEN_KEYS = new Set(["root_token", "unseal_keys_b64", "unseal_keys", "recovery_keys"]);

export type VaultAuthEvidence = {
  approleFilesPresent: boolean;
  approleToken: string | null;
  rootToken?: string;
};

export function assertVaultAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("VAULT_ADDR_INVALID");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("VAULT_ADDR_INVALID");
  if (url.username || url.password || url.search || url.hash) throw new Error("VAULT_ADDR_INVALID");
  const host = url.hostname;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (host === "127.0.0.1" && port === "8200") throw new Error("VAULT_LEGACY_FORBIDDEN");
  if (!(host === "127.0.0.1" && port === "8300")) throw new Error("VAULT_ADDR_INVALID");
  if (url.pathname && url.pathname !== "/") throw new Error("VAULT_ADDR_INVALID");
  return VAULT_ADDR_NEW;
}

export function assertSecretPath(path: string): string {
  if (typeof path !== "string" || !PATH_RE.test(path) || path.includes("..")) {
    throw new Error("VAULT_PATH_REJECTED");
  }
  return path;
}

export function assertSecretKey(key: string): string {
  if (typeof key !== "string" || !KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) {
    throw new Error("VAULT_KEY_REJECTED");
  }
  return key;
}

export function chooseVaultAuth(evidence: VaultAuthEvidence): { method: "approle" } {
  if (evidence.approleToken) return { method: "approle" };
  if (evidence.approleFilesPresent) throw new Error("VAULT_APPROLE_FAILED");
  throw new Error("VAULT_APPROLE_REQUIRED");
}

export function assertAppRoleApplyApproved(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  if (env.MVH_APPROVE_APPROLE !== APPROLE_APPROVAL) throw new Error("BLOCKED_BY_APPROVAL");
}
