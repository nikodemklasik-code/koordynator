# Control UI endpoint/action audit

Generated for Koordynator Control at `http://127.0.0.1:8787`.

## Pages

| Page | Status | Notes |
|------|--------|-------|
| `/` Tasks | PARTIAL | List/filter/search/refresh/inspect work. `+ New task` is instructional only — no project upload yet. |
| `/chat` Live Chat | OK | Sessions, models, attachments, export, GitHub consent, workspace context, Keychain gateway. |
| `/providers` | PARTIAL | Official CLI rows exist; all currently `UNAVAILABLE`. Connect opens copy-dialog only. No OmniRoute Claude/Grok/Codex live harness. GitHub card works. |
| `/releases` | OK | Health + ledger list + refresh. Read-only by design. |
| `/tasks/:id` | OK | Detail/lifecycle/receipts. |
| `/tasks/:id/return` | OK | Targeted return draft flow. |

## API endpoints

| Endpoint | Methods | UI wired? | Action matches description? |
|----------|---------|-----------|------------------------------|
| `/api/health` | GET | yes | yes |
| `/api/tasks` | GET | yes | yes (list/filter) |
| `/api/tasks/:id` | GET | yes | yes |
| `/api/tasks/:id/detail` | GET | yes | yes |
| `/api/tasks/:id/return` | GET | yes | yes |
| `/api/tasks/:id/next-work-order` | GET | yes (return page) | yes (draft only, not persisted) |
| `/api/tasks/project-pack` | — | no | **MISSING** — needed for ZIP/PDF/TXT/DOC project read |
| `/api/providers` | GET | yes | partial — official CLI only |
| `/api/providers/:id/doctor` | GET | yes | yes for CLI; no OmniRoute families |
| `/api/providers/:id/connect` | — | no | **MISSING** — UI pretends Connect works, only copies CLI text |
| `/api/provider-receipts` | GET | via providers view | yes |
| `/api/integrations/github` | GET | yes | yes |
| `/api/integrations/github/connect` | POST | yes | yes (consent + gh/git) |
| `/api/releases` | GET | yes | yes |
| `/api/releases/current` | GET | indirect | yes |
| `/api/chat/*` | GET/POST | yes | yes |

## Highest-priority functional gaps

1. Providers must show live OmniRoute Claude / Grok / Codex health and runnable doctor/connect actions.
2. Providers Connect must not be a dead dialog for routes that can be checked live.
3. Tasks must accept project packs (zip/pdf/txt/doc) and surface extracted briefing for process logic — not only free-text objective instructions.

## Acceptance

- Every visible button either performs its described action or is removed/relabeled.
- Every listed endpoint is reachable from UI or documented as operator-CLI-only.
- No placeholder cards that look interactive but only copy inert text.
