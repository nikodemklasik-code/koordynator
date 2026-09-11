#!/usr/bin/env python3
"""Least-privilege AppRole apply for mvh-vault-bridge 0.4.0.

Runs on the Vault host. Reads the root token only from /root/vault-new-init.json
and never prints it. After a verified AppRole login, writes credentials to
/etc/mvh-vault so the overlay bridge stops using root-fallback.

Approval: MVH_APPROVE_APPROLE=I_APPROVE_LEAST_PRIVILEGE_APPROLE
"""
from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import urllib.error
import urllib.request

APPROVAL = "I_APPROVE_LEAST_PRIVILEGE_APPROLE"
VAULT_ADDR = "http://127.0.0.1:8300"
INIT_FILE = "/root/vault-new-init.json"
CRED_DIR = "/etc/mvh-vault"
ROLE_ID_FILE = os.path.join(CRED_DIR, "approle-role-id")
SECRET_ID_FILE = os.path.join(CRED_DIR, "approle-secret-id")
ROLE_NAME = "mvh-overlay"
POLICY_NAME = "mvh-overlay"
BRIDGE = "/usr/local/sbin/mvh-vault-bridge"

OVERLAY_POLICY = """\
# Overlay control plane (mvh-vault-bridge). Workers never get this role.
# Paths match overlay 0.4.0: secret/apps/{shared,project,projects/<slug>}
# plus inventory of existing app folders. No sys/*, no unseal, no root.

path "secret/data/apps/shared" {
  capabilities = ["create", "read", "update", "patch"]
}
path "secret/data/apps/project" {
  capabilities = ["create", "read", "update", "patch"]
}
path "secret/data/apps/projects/*" {
  capabilities = ["create", "read", "update", "patch"]
}
path "secret/data/apps/*" {
  capabilities = ["create", "read", "update", "patch"]
}
path "secret/metadata/apps" {
  capabilities = ["read", "list"]
}
path "secret/metadata/apps/*" {
  capabilities = ["read", "list"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
"""

OMNIROUTE_POLICY = """\
path "secret/data/apps/omniroute" {
  capabilities = ["read"]
}
path "secret/data/apps/shared" {
  capabilities = ["read"]
}
path "secret/metadata/apps/omniroute" {
  capabilities = ["read"]
}
path "secret/metadata/apps/shared" {
  capabilities = ["read"]
}
"""


def fail(code: str, detail: str = "") -> None:
    payload = {"ok": False, "error": code}
    if detail:
        payload["detail"] = detail
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    raise SystemExit(1)


def vault(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Vault-Token"] = token
    req = urllib.request.Request(VAULT_ADDR + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            raw = response.read() or b"{}"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read() or b"{}"
        try:
            obj = json.loads(raw)
        except Exception:
            obj = {"errors": [error.reason]}
        return error.code, obj


def require_ok(status: int, obj: dict, code: str) -> dict:
    if status < 200 or status >= 300:
        errors = obj.get("errors") or [f"HTTP {status}"]
        fail(code, "; ".join(str(item) for item in errors)[:240])
    return obj


def write_secret_file(path: str, value: str) -> None:
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value.strip() + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def file_mode(path: str) -> str:
    return oct(stat.S_IMODE(os.stat(path).st_mode))


def main() -> None:
    if os.environ.get("MVH_APPROVE_APPROLE") != APPROVAL:
        fail("BLOCKED_BY_APPROVAL")
    if os.geteuid() != 0:
        fail("MUST_RUN_AS_ROOT")

    try:
        init = json.load(open(INIT_FILE, encoding="utf-8"))
    except FileNotFoundError:
        fail("VAULT_INIT_MISSING")
    root_token = init.get("root_token")
    if not isinstance(root_token, str) or not root_token.strip():
        fail("VAULT_ROOT_TOKEN_MISSING")

    status, health = vault("GET", "/v1/sys/health")
    if status not in (200, 429, 472, 473):
        fail("VAULT_UNAVAILABLE", f"HTTP {status}")
    if health.get("sealed"):
        fail("VAULT_SEALED")
    if health.get("initialized") is not True:
        fail("VAULT_NOT_INITIALIZED")

    status, auths = vault("GET", "/v1/sys/auth", token=root_token)
    require_ok(status, auths, "VAULT_AUTH_LIST_FAILED")
    methods = auths.get("data") or auths
    if "approle/" not in methods:
        status, obj = vault("POST", "/v1/sys/auth/approle", token=root_token, body={"type": "approle"})
        require_ok(status, obj, "VAULT_APPROLE_ENABLE_FAILED")

    status, obj = vault("PUT", f"/v1/sys/policies/acl/{POLICY_NAME}", token=root_token, body={"policy": OVERLAY_POLICY})
    require_ok(status, obj, "VAULT_POLICY_WRITE_FAILED")

    status, obj = vault("PUT", "/v1/sys/policies/acl/omniroute", token=root_token, body={"policy": OMNIROUTE_POLICY})
    require_ok(status, obj, "VAULT_OMNIROUTE_POLICY_WRITE_FAILED")

    status, obj = vault(
        "POST",
        f"/v1/auth/approle/role/{ROLE_NAME}",
        token=root_token,
        body={
            "token_ttl": "1h",
            "token_max_ttl": "4h",
            "token_policies": [POLICY_NAME],
            "bind_secret_id": True,
            "secret_id_ttl": "0",
            "token_bound_cidrs": ["127.0.0.1/32"],
            "token_type": "default",
        },
    )
    require_ok(status, obj, "VAULT_APPROLE_ROLE_WRITE_FAILED")

    status, obj = vault("GET", f"/v1/auth/approle/role/{ROLE_NAME}/role-id", token=root_token)
    require_ok(status, obj, "VAULT_ROLE_ID_READ_FAILED")
    role_id = ((obj.get("data") or {}).get("role_id"))
    if not isinstance(role_id, str) or not role_id.strip():
        fail("VAULT_ROLE_ID_MISSING")

    status, obj = vault("POST", f"/v1/auth/approle/role/{ROLE_NAME}/secret-id", token=root_token, body={})
    require_ok(status, obj, "VAULT_SECRET_ID_CREATE_FAILED")
    secret_id = ((obj.get("data") or {}).get("secret_id"))
    if not isinstance(secret_id, str) or not secret_id.strip():
        fail("VAULT_SECRET_ID_MISSING")

    login_status, login = vault(
        "POST",
        "/v1/auth/approle/login",
        body={"role_id": role_id, "secret_id": secret_id},
    )
    require_ok(login_status, login, "VAULT_APPROLE_LOGIN_FAILED")
    client_token = ((login.get("auth") or {}).get("client_token"))
    policies = ((login.get("auth") or {}).get("token_policies")) or []
    if not isinstance(client_token, str) or not client_token.strip():
        fail("VAULT_APPROLE_LOGIN_FAILED", "empty client_token")
    if POLICY_NAME not in policies:
        fail("VAULT_APPROLE_POLICY_MISSING", ",".join(str(item) for item in policies))

    lookup_status, lookup = vault("GET", "/v1/auth/token/lookup-self", token=client_token)
    require_ok(lookup_status, lookup, "VAULT_LOOKUP_SELF_FAILED")
    list_status, listed = vault("LIST", "/v1/secret/metadata/apps", token=client_token)
    if list_status not in (200, 404):
        fail("VAULT_KV_LIST_DENIED", f"HTTP {list_status}")
    sys_status, _ = vault("GET", "/v1/sys/raw/logical", token=client_token)
    if sys_status not in (403, 404):
        fail("VAULT_SYS_NOT_DENIED", f"HTTP {sys_status}")

    os.makedirs(CRED_DIR, mode=0o700, exist_ok=True)
    os.chmod(CRED_DIR, 0o700)
    write_secret_file(ROLE_ID_FILE, role_id)
    write_secret_file(SECRET_ID_FILE, secret_id)

    # Second login from the on-disk files — proves the bridge path before we claim success.
    disk_role = open(ROLE_ID_FILE, encoding="utf-8").read().strip()
    disk_secret = open(SECRET_ID_FILE, encoding="utf-8").read().strip()
    if disk_role != role_id or disk_secret != secret_id:
        fail("VAULT_CREDENTIAL_FILE_MISMATCH")
    disk_status, disk_login = vault(
        "POST",
        "/v1/auth/approle/login",
        body={"role_id": disk_role, "secret_id": disk_secret},
    )
    require_ok(disk_status, disk_login, "VAULT_DISK_LOGIN_FAILED")

    proof = {"ok": False, "authMethod": "unknown"}
    if os.path.isfile(BRIDGE) and os.access(BRIDGE, os.X_OK):
        import subprocess
        result = subprocess.run(
            [BRIDGE],
            input=json.dumps({"op": "connection_proof", "nonce": "koordynator-approle-apply"}).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        try:
            proof = json.loads(result.stdout.decode("utf-8") or "{}")
        except Exception:
            fail("BRIDGE_PROOF_NOT_JSON")
        if not proof.get("ok"):
            fail("BRIDGE_PROOF_FAILED", str(proof.get("error") or "")[:240])
        if proof.get("authMethod") != "approle":
            fail("BRIDGE_STILL_ROOT_FALLBACK", str(proof.get("authMethod")))

    sys.stdout.write(json.dumps({
        "ok": True,
        "vaultAddr": VAULT_ADDR,
        "role": ROLE_NAME,
        "policy": POLICY_NAME,
        "tokenPolicies": policies,
        "credentialDir": CRED_DIR,
        "credentialDirMode": file_mode(CRED_DIR),
        "roleIdMode": file_mode(ROLE_ID_FILE),
        "secretIdMode": file_mode(SECRET_ID_FILE),
        "kvListStatus": list_status,
        "sysRawDenied": sys_status,
        "bridgeAuthMethod": proof.get("authMethod"),
        "bridgeAuthenticated": proof.get("authenticated"),
        "omniroutePolicyWidened": True,
    }, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
