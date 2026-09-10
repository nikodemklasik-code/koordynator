# Koordynator Orchestrator

Deterministyczny Orchestrator budowy, walidacji i wydawania aplikacji. AI/provider jest wymiennym wykonawcą. Stan, dowód, walidacja i decyzja o release są kontrolowane przez kod.

## Wymagania

- Node.js 20+
- `npm ci`
- dla najmocniejszej izolacji buildu: Docker albo Podman i obraz przypięty przez `@sha256:...`
- dla providerów abonamentowych: oficjalny CLI danego dostawcy i oficjalna sesja logowania

## Instalacja i weryfikacja

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
node dist/cli/main.js version
```

Po `npm link` dostępna jest komenda `orchestrator`.

## Kanoniczny przebieg

```text
SIGNED WORK ORDER
  -> CREATED -> READY -> BUILDING -> BUILD_READY
  -> CANDIDATE_FROZEN
  -> VALIDATING
  -> APPROVED
  -> RELEASING
  -> CANARY / PRODUCTION
  -> RELEASED

FAIL po freeze
  -> RETURNED
  -> revision N+1
```

Nie ma SHA gate przed freeze. Release jest związany z dokładnym `candidateSha` i `artifactFp`. Brak wymaganego walidatora daje `UNEXECUTED`, a `FAIL`, `UNEXECUTED`, `EXPIRED`, revoked albo stale-policy blokują release.

## CLI

```bash
orchestrator plan work-order.json
orchestrator sign work-order.json \
  --private-key owner-private.pem \
  --key-id owner-1 \
  --out signed-work-order.json

orchestrator run run.json \
  --public-key owner-public.pem \
  --release-key release-private.pem \
  --key-id owner-1 \
  --state-dir .orchestrator

orchestrator status TASK-123 --state-dir .orchestrator
orchestrator replay TASK-123 0 --public-key owner-public.pem --state-dir .orchestrator
orchestrator releases --state-dir .orchestrator
orchestrator rollback sha256:... --state-dir .orchestrator

orchestrator provider list
orchestrator provider doctor
orchestrator provider connect openai-codex-sub
orchestrator provider connect claude-code-sub
orchestrator provider connect gemini-cli-sub
orchestrator provider connect github-copilot-sub
```

`provider connect` uruchamia oficjalny flow dostawcy. Orchestrator nie prosi o hasło providera i nie zbiera cookies przeglądarki.

## WorkOrder

WorkOrder jest jedyną komendą wykonawczą. Luźny prompt, `instructions` lub dodatkowe pola poza podpisaną kopertą są odrzucane przez execution gate.

Minimalny kształt:

```json
{
  "taskId": "TASK-123",
  "workspaceId": "WS-123",
  "revision": 0,
  "objective": "Build application",
  "scope": { "modules": ["app"], "allowedPaths": ["src/**"] },
  "requiredInputs": [],
  "capabilities": ["repo.write"],
  "budget": { "timeSec": 600, "costLimit": 10, "retries": 2, "maxDagDepth": 8 },
  "requiredGates": ["unit", "security"],
  "expectedEvidence": ["security"],
  "acceptanceCriteria": ["required gates pass"],
  "failureCriteria": ["required gate fails"],
  "securityContractRef": "sha256:...",
  "performanceContractRef": "sha256:...",
  "rollbackRequirement": "REVERSIBLE",
  "humanApprovalPolicy": "AUTO_IF_POLICY_PASS",
  "policyRef": { "policyId": "release-v1", "bundleHash": "sha256:..." }
}
```

## Run config

`run.json` zawiera podpisany WorkOrder, `BuildInputVector`, fingerprint manifestu, plan buildu i wymagane walidatory. Validator uruchamia się na rozpakowanym dokładnym artefakcie kandydata, nie na przypadkowym workspace.

Przykład planu procesu:

```json
{
  "sourceDir": "./example-app",
  "command": "node",
  "args": ["build.mjs"],
  "artifactPaths": ["dist"],
  "timeoutMs": 60000,
  "maxOutputBytes": 1048576
}
```

Dla izolacji kontenerowej kod udostępnia `ContainerHermeticBuilder`: obraz musi być przypięty przez SHA-256, sieć jest wyłączona, capabilities są usuwane, działa `no-new-privileges`, read-only rootfs, limity PID/CPU/RAM i efemeryczny workspace.

## Provider Fabric

Provider Fabric obsługuje `MONO` i `MULTI`, routing security-first, klasy S0-S5, billing policy, jawny paid API fallback, provider diversity i failover tylko dla operacji zabezpieczonych idempotency key.

Obsługiwane ścieżki transportowe:

- `OFFICIAL_CLI`
- `OFFICIAL_SDK`
- `RAW_API`
- `LOCAL_RUNTIME`

Abonament nie jest traktowany jak API. `SUBSCRIPTION_ONLY` nie przechodzi po cichu na płatne API. `SUBSCRIPTION_FIRST` może przejść na API tylko przy jawnym `allowPaidApiFallback` i dodatnim budżecie.

## Trwały stan i artefakty

Domyślny katalog `.orchestrator/` przechowuje:

- historię stanów i bieżący stan tasku,
- immutable signed WorkOrders per revision,
- content-addressed artifact cache,
- release ledger i aktualny production release.

Sekrety providera nie są zapisywane w tych magazynach.

## Testy akceptacyjne

CI wykonuje między innymi:

- A: build -> freeze -> required gates -> exact artifact release,
- B: failure po freeze -> `RETURNED` -> revision N+1 -> nowy candidate,
- C: cache hit/miss/revocation dla BuildInputVector,
- D: zmiana policy fingerprint unieważnia wcześniejsze PASS,
- P1-P6 Provider Fabric: MONO, MULTI/diversity, subscription exhaustion, auth expiry, idempotent failover, adapter version drift,
- rzeczywisty ephemeral process build i walidację spakowanego artefaktu,
- scheduler dependencies/resources/tenant concurrency,
- canary/promote/rollback,
- network-denied container isolation contract,
- immutable replay podpisanego WorkOrder.

## Zasady repozytorium

`main` jest gałęzią stabilną. Zmiany przechodzą przez testowaną gałąź zadaniową i PR. Po integracji niepotrzebna gałąź robocza powinna zostać usunięta.
