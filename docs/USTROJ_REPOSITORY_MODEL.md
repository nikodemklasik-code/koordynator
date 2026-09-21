# Ustrój repository model

## Target repository

Preferred name: `nikodemklasik-code/Korporacja`.

Why this name:
- `Korporacja` describes the governed organization directly.
- `Ekosystem` is broader and better treated as the set of connected products/repos.
- `Univers` is less precise as an engineering and governance boundary.

The target repository is not considered created until GitHub reports that repository as existing.

## Core branch

`main` is the only long-lived core branch.

Rules:
1. `main` must remain buildable and internally coherent.
2. Every constitutional element begins from the current `main`.
3. One branch represents one constituent element only.
4. Branch form: `component/<element>`.
5. Required tests/audit must pass before integration.
6. After integration to `main`, delete the component branch.
7. No parallel long-lived `develop` branch is part of this repository model.

## Initial constituent branches

- `component/harmonia`
- `component/hll`
- `component/brain`
- `component/vera`
- `component/corporation`
- `component/product-bridges`

These are branch names/lifecycle contracts, not evidence that the branches or target repository already exist.

## Product boundary

Koordynator/Brain is executive coordination.
Harmonia is constitutional authority.
HLL is semantic/truth authority.
VERA controls capabilities and material effects.
Corporation owns organizational structure and execution roles.
Harmonia Legal Platform and Job App are products connected by explicit contracts, not code copied into the core by default.
