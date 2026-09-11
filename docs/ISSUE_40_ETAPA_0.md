# Issue #40 — Etap 0 beginning

Constitutional boundary and execution contracts. This is not multi-worker autonomy.

## Landed

- Harmonia mandate + append-only verdicts
- TaskEnvelope + contract fingerprint
- Admission gate: mandate × envelope × Vault reachability
- Write leases with path overlap
- Idempotency registry for side effects
- UI gate that refuses UNEXECUTED / STALE / SEE_AGENT_REPORT substitutes
- Worker capability registry (no worker-to-worker dispatch)
- Capability ticket broker (fail closed without Vault)
- Hermes profile no longer persists `model.api_key` on disk

## Still FAIL / out of this commit

- Hermes child process still receives `OPENAI_API_KEY` in env so existing local launch keeps working
- Vault on VPS is not wired
- Redis/BullMQ, PostgreSQL source of truth, sandboxes, independent verifier receipts
- Multi-worker autonomy remains BLOCKED
- Production auto-deploy remains BLOCKED
