#!/usr/bin/env python3
"""Split the HLP VERA Builder Codepack v4.2 into per-branch build segments.

Authority order (never invented here):
  1. HLP_INSTRUKCJA_BUDOWY_MAIN_DEVELOP_VERA_v4.2.md  - H0..H9 gate order
  2. builder/ASSEMBLY_ORDER.md                        - 19 assembly steps
  3. validation/EXTERNAL_BLOCKERS.json                - normative blockers

Each segment becomes one git branch on the target repo. A segment carries only
the files the instruction assigns to it, plus the exact gate it must pass.
Timing for every phase is printed so the split is measurable, not guessed.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
import zipfile
from dataclasses import dataclass, field, asdict
from pathlib import Path

ZIP_PATH = Path.home() / "Desktop" / "HLP_VERA_BUILDER_CODEPACK_v4.2.zip"
INSTRUCTION = Path.home() / "Desktop" / "HLP_INSTRUKCJA_BUDOWY_MAIN_DEVELOP_VERA_v4.2.md"
OUT_ROOT = Path.home() / "Desktop" / "HLP_SEGMENTY_v4.2"
EXPECTED_ZIP_SHA = "4e203daff479cb7f796e6464e459727816d87b49e45db745a9cef0a653edb718"
COMPANION_SHA = "6be952c2bb775312a90cf6f32f888ed7178af9f5c897a24b9fed304af5db2611"
PKG = "HLP_VERA_BUILDER_CODEPACK_v4.2"


@dataclass
class Segment:
    seg_id: str
    branch: str
    title: str
    phase: str
    # Path prefixes relative to the codepack root. Copied verbatim.
    includes: list[str]
    gate: list[str]
    depends_on: list[str]
    notes: str = ""
    # Prefixes carved out of `includes` because another segment owns them.
    # Every file must land in exactly one branch, otherwise two branches edit
    # the same path and the merge into develop conflicts.
    excludes: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    bytes_total: int = 0


# Segment table transcribed from instruction sections 10 (H1-H8), 12, 13, 17, 18
# and ASSEMBLY_ORDER.md steps 1-19. Nothing here is inferred beyond those files.
SEGMENTS: list[Segment] = [
    Segment(
        "S00", "vera/s00-h0-precheck", "H0 precheck + dependency freeze", "H0",
        ["builder", "validation", "build/H0_H9_GATES.json", "spec/BUILD_RULES.md",
         "core/DEPENDENCY_AUTHORITY.json", "README.md", "pytest.ini"],
        ["origin/main == 0fd6e12e11bf241e088b6d49d37ddad7cc0f1929",
         "origin/develop == 1d0656e685b4f648a1f34ae39d849453ca7f1253",
         "merge-base == MAIN_SHA; main...develop == 0 12",
         "worktree clean (git status --short empty)",
         "zip sha256 == " + EXPECTED_ZIP_SHA,
         "Cargo.lock holds only approved deps else STOP NEW_DEPENDENCY_REQUIRED"],
        [],
        "Mismatch on any pin => BASE_MOVED, STOP. Companion ZIP absent => H9 BLOCKED.",
    ),
    Segment(
        "S01", "vera/s01-h1-types-schema-clock", "H1 types / schema / identity / clock", "H1",
        ["core/hlp-vera/crates/vera-core-types",
         "core/hlp-vera/crates/vera-core-schema",
         "core/hlp-vera/crates/vera-core-identity",
         "core/hlp-vera/crates/vera-core-clock",
         "core/hlp-vera/Cargo.toml",
         "schemas"],
        ["cargo test --workspace --locked (these crates)",
         "no DB authority inside pure type crates",
         "schemas registered by exact $id"],
        ["S00"],
        "T0 stays law-agnostic: no CPR/substantive legal nouns in these crates.",
        # schemas/operations holds the B1-B45 request/response pairs; S09 owns them.
        excludes=["schemas/operations"],
    ),
    Segment(
        "S02", "vera/s02-h2-store-audit", "H2 store / audit / SQL migrations", "H2",
        ["core/hlp-vera/crates/vera-core-store",
         "core/hlp-vera/crates/vera-core-audit",
         "core/hlp-vera/sql",
         "db"],
        ["migrations 0001/0002/0003 apply on clean PostgreSQL",
         "append-only denial PASS",
         "scope RLS PASS",
         "CAS concurrency PASS"],
        ["S01"],
        "No PostgreSQL runtime => NOT_EXECUTED, never PASS.",
    ),
    Segment(
        "S03", "vera/s03-h3-policy-capability", "H3 policy / capability", "H3",
        ["core/hlp-vera/crates/vera-core-policy",
         "core/hlp-vera/crates/vera-core-capability"],
        ["negative tests: forged, self-issued, revoked, cross-scope all fail closed"],
        ["S02"],
    ),
    Segment(
        "S04", "vera/s04-h4-receipt-promotion", "H4 receipt / promotion", "H4",
        ["core/hlp-vera/crates/vera-core-receipt",
         "core/hlp-vera/crates/vera-core-promotion"],
        ["forged receipt rejected", "duplicate receipt rejected",
         "subject mismatch rejected", "issuer/verifier separation held"],
        ["S03"],
    ),
    Segment(
        "S05", "vera/s05-h5-module-registry", "H5 module registry + protocol", "H5",
        ["core/hlp-vera/crates/vera-core-module",
         "core/hlp-vera/protocol",
         "manifest"],
        ["T2 cannot obtain WriteCanonical, Promote or ExecuteEffect",
         "protocol files registered by exact $id"],
        ["S04"],
    ),
    Segment(
        "S06", "vera/s06-h6-provenance", "H6 provenance", "H6",
        ["core/hlp-vera/crates/vera-core-provenance"],
        ["multi-hop impact exact", "stale state exact", "rollback correct"],
        ["S05"],
    ),
    Segment(
        "S07", "vera/s07-h7-effect", "H7 effect authority", "H7",
        ["core/hlp-vera/crates/vera-core-effect",
         "composition/effect_execution_sequence.json"],
        ["only sequence: prepare/check -> permit -> atomic consume -> adapter -> effect receipt -> audit",
         "absent customer connector => BLOCKED_NOT_CONFIGURED"],
        ["S06"],
    ),
    Segment(
        "S08", "vera/s08-h8-human-runtime", "H8 human act / runtime + 20-step acceptance", "H8",
        ["core/hlp-vera/crates/vera-core-human-act",
         "core/hlp-vera/crates/vera-core-runtime",
         "tests/core_acceptance_scenario_20_steps.json"],
        ["20-step Core acceptance scenario PASS"],
        ["S07"],
    ),
    Segment(
        "S09", "vera/s09-modules-b1-b45", "B1-B45 module contracts (135 operations)", "MODULES",
        ["modules",
         "schemas/operations",
         "composition/module_contract_index.json",
         "composition/module_edges.json",
         "composition/core_method_aliases.json"],
        ["135 operation keys closed - adding a 136th requires canon change",
         "module manifests registered exactly"],
        ["S05"],
    ),
    Segment(
        "S10", "vera/s10-engines-e01-e22", "E01-E22 wrappers + 6 canonical T1 families", "ENGINES",
        ["engines", "composition/engine_registry.json"],
        ["no engine adds a substantive legal rule",
         "T1 families stay plan-driven by versioned Law Packs"],
        ["S09"],
    ),
    Segment(
        "S11", "vera/s11-security-envelope", "Screen Security Envelope / Action Broker / sanitisation", "SECURITY",
        ["security", "composition/action_wiring.json", "composition/screen_bindings.json"],
        ["screens bound through envelope + pipeline before protected data",
         "UI click is intent, never authority",
         "sanitisation, permission-first search, Secret S4, SYS states, kill switches bound"],
        ["S07"],
    ),
    Segment(
        "S12", "vera/s12-host-bridge", "Host bridge / deterministic router / runtime bindings", "HOST",
        ["host", "composition/core_bridge_protocol.json",
         "composition/builder_runtime_protocol.json"],
        ["closed NDJSON bridge dispatcher only",
         "no direct canonical DB authority from Python/TS"],
        ["S08"],
    ),
    Segment(
        "S13", "vera/s13-ui-frameworkless", "Canonical frameworkless UI", "UI",
        ["ui/frameworkless", "ui/UI_AUTHORITY.json", "ui/screens"],
        ["strict TypeScript typecheck PASS",
         "ui/screens/*.tsx stays reference-only; do NOT add React"],
        ["S11"],
        "ui/screens/*.tsx ships as reference material only - it must never pull React "
        "into the build.",
    ),
    Segment(
        "S14", "vera/s14-rest-contract", "REST routes strictly from source", "REST",
        ["composition/rest_routes.json", "composition/rest_bindings.json",
         "composition/rest_contract_authority.json"],
        ["expose only source-declared routes",
         "no invented CRUD; extra route needs separate API authority"],
        ["S12"],
    ),
    Segment(
        "S15", "vera/s15-civil-lifecycle", "Civil lifecycle L00-L25 registry", "LIFECYCLE",
        ["composition/civil_lifecycle_L00_L25.json",
         "composition/editor_command_bindings.json"],
        ["stage names and order are closed - load exactly"],
        ["S09"],
    ),
    Segment(
        "S16", "vera/s16-sdk", "SDK contracts", "SDK",
        ["sdk", "adapters"],
        ["SDK contract tests PASS"],
        ["S12"],
    ),
    Segment(
        "S17", "vera/s17-negative-matrix", "N01-N25 negative matrix + closure tests", "TESTS",
        ["tests", "composition/assembly_closure.json", "composition/e2e_journeys.json",
         "composition/E2E_COMPOSITION.md", "composition/root.json"],
        ["every N01-N25 scenario yields its exact fail-closed outcome",
         "no shortening to a representative sample",
         "pytest baseline: 120 passed"],
        ["S13", "S14", "S15", "S16"],
        "The 20-step acceptance scenario belongs to S08/H8, which executes it.",
        excludes=["tests/core_acceptance_scenario_20_steps.json"],
    ),
    Segment(
        "S18", "vera/s18-h9-legacy-recovery", "H9 legacy recovery (BLOCKED)", "H9",
        ["recovery"],
        ["entry requires H1-H8 REAL PASS",
         "exact companion ZIP present, sha256 == " + COMPANION_SHA],
        ["S17"],
        "Companion ZIP absent on this machine => H9=BLOCKED_SOURCE_BYTES_UNAVAILABLE. "
        "Never reconstruct or substitute it.",
    ),
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    t_start = time.perf_counter()
    timings: list[tuple[str, float]] = []

    def mark(label: str, since: float) -> None:
        elapsed = time.perf_counter() - since
        timings.append((label, elapsed))
        print(f"[{elapsed:7.3f}s] {label}", flush=True)

    step = time.perf_counter()
    if not ZIP_PATH.exists():
        print(f"BLOCKED: missing {ZIP_PATH}", file=sys.stderr)
        return 2
    actual_sha = sha256_file(ZIP_PATH)
    zip_ok = actual_sha == EXPECTED_ZIP_SHA
    mark(f"sha256 zip ({'MATCH' if zip_ok else 'MISMATCH'})", step)

    step = time.perf_counter()
    stage = Path("/tmp/hlp_vera_stage")
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    with zipfile.ZipFile(ZIP_PATH) as archive:
        archive.extractall(stage)
    root = stage / PKG
    all_files = sorted(p for p in root.rglob("*") if p.is_file())
    mark(f"unzip staged ({len(all_files)} files)", step)

    step = time.perf_counter()
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    OUT_ROOT.mkdir(parents=True)

    assigned: dict[str, list[str]] = {}
    for segment in SEGMENTS:
        seg_dir = OUT_ROOT / f"{segment.seg_id}_{segment.branch.split('/')[-1]}"
        payload = seg_dir / "payload"
        for include in segment.includes:
            source = root / include
            if not source.exists():
                continue
            if source.is_file():
                target = payload / include
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                rel = include
                segment.files.append(rel)
                segment.bytes_total += source.stat().st_size
                assigned.setdefault(rel, []).append(segment.seg_id)
            else:
                for item in sorted(source.rglob("*")):
                    if not item.is_file():
                        continue
                    rel = str(item.relative_to(root))
                    if any(rel == ex or rel.startswith(ex + "/") for ex in segment.excludes):
                        continue
                    target = payload / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, target)
                    segment.files.append(rel)
                    segment.bytes_total += item.stat().st_size
                    assigned.setdefault(rel, []).append(segment.seg_id)
    mark("segments materialised", step)

    # Conflict / gap analysis against the real file tree.
    step = time.perf_counter()
    covered = set(assigned)
    every = {str(p.relative_to(root)) for p in all_files}
    uncovered = sorted(every - covered)
    duplicated = {rel: segs for rel, segs in assigned.items() if len(segs) > 1}

    findings: list[dict[str, str]] = []
    for segment in SEGMENTS:
        missing = [inc for inc in segment.includes if not (root / inc).exists()]
        for miss in missing:
            findings.append({
                "severity": "GAP",
                "segment": segment.seg_id,
                "detail": f"instruction references '{miss}' but the codepack has no such path",
            })
        for dep in segment.depends_on:
            if dep not in {s.seg_id for s in SEGMENTS}:
                findings.append({
                    "severity": "CONTRADICTION",
                    "segment": segment.seg_id,
                    "detail": f"depends on unknown segment {dep}",
                })
        if not segment.files:
            findings.append({
                "severity": "EMPTY",
                "segment": segment.seg_id,
                "detail": "segment carries no files - check include prefixes",
            })
    for rel, segs in duplicated.items():
        findings.append({
            "severity": "OVERLAP",
            "segment": "+".join(segs),
            "detail": f"{rel} copied into multiple segments",
        })
    if not zip_ok:
        findings.append({
            "severity": "BLOCKER",
            "segment": "S00",
            "detail": f"zip sha256 {actual_sha} != pinned {EXPECTED_ZIP_SHA}",
        })
    companion = Path.home() / "Desktop" / "HLP_VERA_RECOVERED_PARTS_v0.1.zip"
    if not companion.exists():
        findings.append({
            "severity": "BLOCKER",
            "segment": "S18",
            "detail": "companion HLP_VERA_RECOVERED_PARTS_v0.1.zip absent => H9=BLOCKED_SOURCE_BYTES_UNAVAILABLE",
        })
    mark(f"analysis ({len(findings)} findings, {len(uncovered)} unassigned files)", step)

    # Per-segment instruction file.
    step = time.perf_counter()
    for segment in SEGMENTS:
        seg_dir = OUT_ROOT / f"{segment.seg_id}_{segment.branch.split('/')[-1]}"
        lines = [
            f"# {segment.seg_id} - {segment.title}",
            "",
            f"Branch: `{segment.branch}`",
            f"Phase: {segment.phase}",
            f"Depends on: {', '.join(segment.depends_on) or 'nothing'}",
            f"Files: {len(segment.files)} ({segment.bytes_total / 1024:.1f} KB)",
            "",
            "## Gate - must be REAL execution, never source review",
        ]
        lines += [f"- [ ] {g}" for g in segment.gate]
        lines += [
            "",
            "## Build rule",
            "COPY -> VERIFY HASH/CONTRACT -> CONNECT -> CONFIGURE EXACT EXTERNAL VALUES"
            " -> RUN REQUIRED GATES -> REPORT BLOCKER.",
            "Never invent a route, legal rule, dependency, schema field, status, trust"
            " conversion, fallback authority or effect path.",
            "UNEXECUTED / NOT_EXECUTED / BLOCKED is never PASS.",
        ]
        if segment.notes:
            lines += ["", "## Notes", segment.notes]
        lines += [
            "",
            "## Branch workflow",
            "```bash",
            "git checkout develop",
            f"git checkout -b {segment.branch}",
            f"# copy payload/ into the repo at the paths shown in FILES.txt",
            "# run the gate above, record the receipt, then open a PR into develop",
            "```",
            "",
            "## Included paths",
        ]
        lines += [f"- `{inc}`" for inc in segment.includes]
        (seg_dir / "SEGMENT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (seg_dir / "FILES.txt").write_text("\n".join(segment.files) + "\n", encoding="utf-8")

    index = {
        "source_zip": str(ZIP_PATH),
        "source_zip_sha256": actual_sha,
        "source_zip_sha_matches_pin": zip_ok,
        "instruction": str(INSTRUCTION),
        "repository": "nikodemklasik-code/Harmonia-Legal-Platform",
        "base_branch": "develop",
        "segments": [
            {k: v for k, v in asdict(s).items() if k != "files"} | {"file_count": len(s.files)}
            for s in SEGMENTS
        ],
        "findings": findings,
        "unassigned_files": uncovered,
        "totals": {
            "files_in_zip": len(all_files),
            "files_assigned": len(covered),
            "files_unassigned": len(uncovered),
            "segments": len(SEGMENTS),
        },
    }
    (OUT_ROOT / "INDEX.json").write_text(json.dumps(index, indent=2), encoding="utf-8")

    overview = ["# HLP VERA v4.2 - podział na segmenty", "",
                f"Repozytorium: `nikodemklasik-code/Harmonia-Legal-Platform`, baza: `develop`.",
                f"Plików w ZIP: {len(all_files)}; przypisanych: {len(covered)}; nieprzypisanych: {len(uncovered)}.",
                "", "| Segment | Gałąź | Faza | Plików | Zależy od |", "|---|---|---|---|---|"]
    for s in SEGMENTS:
        overview.append(
            f"| {s.seg_id} | `{s.branch}` | {s.phase} | {len(s.files)} | {', '.join(s.depends_on) or '-'} |"
        )
    overview += ["", "## Znalezione problemy", ""]
    if findings:
        overview += [f"- **{f['severity']}** [{f['segment']}] {f['detail']}" for f in findings]
    else:
        overview.append("- brak")
    overview += ["", "## Kolejność wykonania", "",
                 "H0 -> H1 -> H2 -> H3 -> H4 -> H5 -> H6 -> H7 -> H8, potem moduły/silniki/UI/REST,",
                 "na końcu N01-N25. H9 dopiero po realnym PASS H1-H8 i po dostarczeniu companion ZIP.",
                 "", "Każdy segment = jedna gałąź = jeden PR do `develop`."]
    (OUT_ROOT / "README.md").write_text("\n".join(overview) + "\n", encoding="utf-8")
    mark("instructions written", step)

    total = time.perf_counter() - t_start
    print()
    print("=== TIMING ===")
    for label, elapsed in timings:
        print(f"  {elapsed:7.3f}s  {label}")
    print(f"  {total:7.3f}s  TOTAL")
    print()
    print(f"OUT: {OUT_ROOT}")
    print(f"SEGMENTS: {len(SEGMENTS)}  FINDINGS: {len(findings)}  UNASSIGNED: {len(uncovered)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
