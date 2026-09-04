# Koordynator

Repozytorium źródłowe dla modularnego Orchestratora budowy aplikacji zgodnego ze specyfikacją V3 FINAL.

## Zasady repozytorium

- `main` pozostaje gałęzią stabilną.
- Prace rozwojowe prowadzone są na krótkotrwałych gałęziach zadaniowych.
- Gałąź po zakończeniu, walidacji i integracji ma zostać usunięta.
- Nie utrzymujemy martwych, porzuconych ani duplikujących się gałęzi.
- Każdy release ma wskazywać dokładny `candidate_sha`, `artifactFp`, receipts i wynik wymaganych gate'ów.

## Pierwszy etap

Budowa Orchestratora V3 MVP: state machine, WorkOrder, hermetic build, candidate freeze, validation DAG, evidence/impact engine, artifact cache, scheduler, release controller oraz Provider Fabric Mono-API/Multi-API.
