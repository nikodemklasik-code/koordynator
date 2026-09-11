#!/bin/sh
# Apply least-privilege AppRole for the MultivoHub Vault overlay (bridge 0.4.0).
# Runs ONLY on the VPS via SSH. Never prints role-id, secret-id or tokens.
# Requires the overlay approval phrase in the local environment.
set -eu
APPROVAL="I_APPROVE_LEAST_PRIVILEGE_APPROLE"
if [ "${MVH_APPROVE_APPROLE-}" != "$APPROVAL" ]; then
  echo "BLOCKED_BY_APPROVAL"
  exit 2
fi
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HOST="${MVH_VAULT_SSH_HOST:-vps-multivohub}"
# Approval travels as an env var on the remote python; the root token never leaves the VPS.
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
  "MVH_APPROVE_APPROLE=$APPROVAL python3 -s -" \
  < "$HERE/apply-vault-approle.py"
