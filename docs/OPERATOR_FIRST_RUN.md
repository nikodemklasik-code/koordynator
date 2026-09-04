# Operator First Run

Minimalna ścieżka uruchomienia prawdziwego modułu przez Orchestrator.

## 1. Instalacja

```bash
git clone https://github.com/nikodemklasik-code/koordynator.git
cd koordynator
npm ci --ignore-scripts
npm run build
```

## 2. Klucze Ed25519

Klucz właściciela podpisuje WorkOrder. Osobny klucz release podpisuje wydanie.

```bash
mkdir -p .local-keys
chmod 700 .local-keys

openssl genpkey -algorithm ED25519 -out .local-keys/owner-private.pem
openssl pkey -in .local-keys/owner-private.pem -pubout -out .local-keys/owner-public.pem

openssl genpkey -algorithm ED25519 -out .local-keys/release-private.pem
chmod 600 .local-keys/*.pem
```

Kluczy prywatnych nie commitujemy.

## 3. Moduł referencyjny

Repo zawiera prawdziwy moduł `examples/hello-module`. Można też wygenerować nowy szkielet:

```bash
node dist/cli/main.js module create ./my-module \
  --id my-module \
  --capabilities ai.reasoning
```

Moduł zależy od kanonicznego Capability API, nie od SDK OpenAI, Anthropic, Google ani GitHub.

## 4. Pełny golden path

Najkrótsza weryfikacja produkcyjnej ścieżki:

```bash
npm run golden
```

Ten przebieg używa `examples/hello-module` i wykonuje rzeczywiste:

```text
plan -> sign -> run -> ProcessHermeticBuilder
-> exact artifact -> freeze -> unit/security validation
-> canary -> production -> revision R1
-> replay signed WorkOrder -> rollback R1 -> R0
```

Skrypt kończy się błędem, jeśli `candidateSha` lub `artifactFp` release nie odpowiada zamrożonemu kandydatowi.

## 5. Ręczny plan / sign / run

```bash
node dist/cli/main.js plan work-order.json

node dist/cli/main.js sign work-order.json \
  --private-key .local-keys/owner-private.pem \
  --key-id owner-1 \
  --out signed-work-order.json

node dist/cli/main.js run run.json \
  --public-key .local-keys/owner-public.pem \
  --release-key .local-keys/release-private.pem \
  --key-id owner-1 \
  --state-dir .orchestrator
```

`.orchestrator/` zawiera state history, immutable signed WorkOrders, artifact registry/freeze markers i release ledger. Nie przechowuje haseł providerów.

## 6. Provider CLI

```bash
node dist/cli/main.js provider doctor
```

`UNAVAILABLE` oznacza, że dany CLI nie jest zainstalowany. `BLOCKED` oznacza niezgodny format/version probe i adapter nie będzie zgadywał sposobu wywołania.

Oficjalne ścieżki logowania uruchamia się przez:

```bash
node dist/cli/main.js provider connect openai-codex-sub
node dist/cli/main.js provider connect claude-code-sub
node dist/cli/main.js provider connect gemini-cli-sub
node dist/cli/main.js provider connect github-copilot-sub
```

Orchestrator nie pobiera hasła dostawcy, nie czyta cookies przeglądarki i nie zamienia abonamentu w nieudokumentowane API.

## 7. Weryfikacja przed pracą

```bash
npm run verify
```

Wymagane są: typecheck, testy A-D/P1-P6/P0/O9, build, CLI E2E oraz golden path na `hello-module`.
