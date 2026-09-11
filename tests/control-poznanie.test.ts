import { describe, expect, it } from "vitest";
import { Poznanie, PoznanieError, decideVerdict, type Finding } from "../src/control/poznanie.js";

function gateway(content: string, status = 200): { fetchImpl: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status, headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "POZNANIE-001", severity: "MINOR", claim: "c",
    evidence: [{ address: "§1" }], expected: "e", actual: "a", impact: "i",
    confidence: "POTWIERDZONE", ...over
  };
}

const CLEAN = JSON.stringify({
  status: "POTWIERDZONE",
  theses: [
    { id: "T1", kind: "FAKT", claim: "Panel ma mieć tryb ciemny.", address: "§1" },
    { id: "T2", kind: "ŻYCZENIE", claim: "Ma być ładnie." }
  ],
  terms: [{ term: "tryb ciemny", definition: "wariant kolorystyczny interfejsu" }],
  findings: [],
  coverage: { included: ["opis panelu"], excluded: ["backend"] },
  limitations: ["brak makiet"],
  counterexampleAttempt: { performed: true, result: "brak kontrprzykładu w zakresie" }
});

describe("/poznanie — werdykt wg VERDICT_POLICY", () => {
  it("INV-POZNANIE-01: jeden finding KARDYNALNY daje BLOCK i nie uśrednia się z pozytywami", () => {
    expect(decideVerdict([finding({ severity: "CARDINAL" })], true)).toBe("BLOCK");
    // Nawet w towarzystwie samych INFO — blocker nie podlega uśrednieniu.
    expect(decideVerdict([
      finding({ severity: "INFO" }), finding({ severity: "CARDINAL" }), finding({ severity: "INFO" })
    ], true)).toBe("BLOCK");
    // I niezależnie od braku próby obalenia — BLOCK ma pierwszeństwo.
    expect(decideVerdict([finding({ severity: "CARDINAL" })], false)).toBe("BLOCK");
  });

  it("INV-POZNANIE-02: PASS nie zawiera findingu do naprawy przed startem", () => {
    expect(decideVerdict([], true)).toBe("PASS");
    expect(decideVerdict([finding({ severity: "MAJOR" })], true)).toBe("REVISE");
    expect(decideVerdict([finding({ severity: "MINOR" })], true)).toBe("PASS_WARUNKOWY");
  });

  it("brak próby obalenia to INCOMPLETE, nigdy PASS", () => {
    expect(decideVerdict([], false)).toBe("INCOMPLETE");
  });
});

describe("/poznanie — wykonanie", () => {
  it("zwraca kanoniczny raport z tezami, pokryciem i próbą obalenia", async () => {
    const { fetchImpl, bodies } = gateway(CLEAN);
    const report = await new Poznanie({ apiKey: "k", model: "cc/claude-opus-4-8", fetchImpl })
      .run("Panel ma mieć tryb ciemny.");

    expect(report.command).toBe("/poznanie");
    expect(report.version).toBe("13.1.0");
    expect(report.verdict).toBe("PASS");
    expect(report.theses.map((item) => item.kind)).toEqual(["FAKT", "ŻYCZENIE"]);
    expect(report.terms[0]!.term).toBe("tryb ciemny");
    expect(report.coverage.excluded).toEqual(["backend"]);
    expect(report.counterexampleAttempt.performed).toBe(true);
    expect(report.scopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(report.runId).toMatch(/^[0-9a-f-]{36}$/i);

    // §10: /lustro jeszcze nie wykonane — nie wolno udawać niezależnej recenzji.
    expect(report.mirror).toEqual({ required: true, status: "PENDING" });
    // §10 kontraktu komendy: tylko dozwolone następne kroki.
    expect(report.nextAllowedCommands).toEqual(["/brzytwa", "/rozwiazanie"]);

    const sent = bodies[0] as { messages: Array<{ content: string }> };
    expect(sent.messages.some((message) => message.content.includes("Panel ma mieć tryb ciemny."))).toBe(true);
  });

  it("finding kardynalny w materiale daje BLOCK", async () => {
    const blocked = JSON.stringify({
      status: "SPRZECZNE",
      theses: [{ id: "T1", kind: "CONSTRAINT", claim: "Bez zmian w UI.", address: "§2" }],
      terms: [],
      findings: [{
        id: "POZNANIE-001", severity: "CARDINAL", claim: "Cel logicznie niemożliwy.",
        evidence: [{ address: "§1", quote: "bez zmian w UI" }],
        expected: "cel osiągalny", actual: "sprzeczność z §2", impact: "nie da się wykonać",
        confidence: "SPRZECZNE"
      }],
      coverage: { included: ["całość"], excluded: [] },
      limitations: [],
      counterexampleAttempt: { performed: true, result: "sprzeczność potwierdzona" }
    });
    const { fetchImpl } = gateway(blocked);
    const report = await new Poznanie({ apiKey: "k", model: "m", fetchImpl }).run("projekt");
    expect(report.verdict).toBe("BLOCK");
    expect(report.findings[0]!.severity).toBe("CARDINAL");
  });

  it("COMMON_CONTRACT §2: teza bez kotwicy nie może być FAKT-em", async () => {
    const unanchored = JSON.stringify({
      status: "HIPOTEZA",
      theses: [{ id: "T1", kind: "FAKT", claim: "To jest prawda." }],
      terms: [], findings: [], coverage: { included: [], excluded: [] }, limitations: [],
      counterexampleAttempt: { performed: true, result: "ok" }
    });
    const { fetchImpl } = gateway(unanchored);
    await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl }).run("p"))
      .rejects.toThrow(/POZNANIE_FACT_WITHOUT_ANCHOR/);
  });

  it("materialny finding bez adresu dowodowego jest odrzucany", async () => {
    const noEvidence = JSON.stringify({
      status: "HIPOTEZA",
      theses: [{ id: "T1", kind: "OPINIA", claim: "c" }],
      terms: [],
      findings: [{
        id: "F1", severity: "CARDINAL", claim: "c", evidence: [],
        expected: "e", actual: "a", impact: "i", confidence: "HIPOTEZA"
      }],
      coverage: { included: [], excluded: [] }, limitations: [],
      counterexampleAttempt: { performed: true, result: "ok" }
    });
    const { fetchImpl } = gateway(noEvidence);
    await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl }).run("p"))
      .rejects.toThrow(/POZNANIE_FINDING_WITHOUT_EVIDENCE/);
  });

  it("odrzuca status, typ tezy i severity spoza kanonu", async () => {
    const base = {
      status: "POTWIERDZONE",
      theses: [{ id: "T1", kind: "OPINIA", claim: "c" }],
      terms: [], findings: [], coverage: { included: [], excluded: [] }, limitations: [],
      counterexampleAttempt: { performed: true, result: "ok" }
    };
    for (const bad of [
      JSON.stringify({ ...base, status: "WYMYSLONY" }),
      JSON.stringify({ ...base, theses: [{ id: "T1", kind: "WYMYSL", claim: "c" }] }),
      JSON.stringify({ ...base, findings: [{ id: "F1", severity: "KRYTYCZNY", claim: "c", evidence: [{ address: "a" }], expected: "e", actual: "a", impact: "i", confidence: "POTWIERDZONE" }] })
    ]) {
      const { fetchImpl } = gateway(bad);
      await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl }).run("p"))
        .rejects.toThrow(PoznanieError);
    }
  });

  it("brak materiału daje NEEDS_INPUT zamiast cichego uzupełnienia", async () => {
    const { fetchImpl } = gateway(CLEAN);
    await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl }).run("   "))
      .rejects.toThrow(/POZNANIE_NEEDS_INPUT/);
  });

  it("nie zmyśla raportu, gdy model odpowiada prozą albo pada", async () => {
    const prose = gateway("Nie mogę ocenić tego materiału.");
    await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl: prose.fetchImpl }).run("p"))
      .rejects.toThrow(/POZNANIE_RESPONSE_NOT_JSON/);

    const failed = gateway("{}", 503);
    await expect(new Poznanie({ apiKey: "k", model: "m", fetchImpl: failed.fetchImpl }).run("p"))
      .rejects.toThrow(/POZNANIE_HTTP_503/);
  });

  it("ten sam zakres daje ten sam scope_hash, inny materiał inny", async () => {
    const first = gateway(CLEAN);
    const a = await new Poznanie({ apiKey: "k", model: "m", fetchImpl: first.fetchImpl }).run("materiał A");
    const second = gateway(CLEAN);
    const b = await new Poznanie({ apiKey: "k", model: "m", fetchImpl: second.fetchImpl }).run("materiał A");
    const third = gateway(CLEAN);
    const c = await new Poznanie({ apiKey: "k", model: "m", fetchImpl: third.fetchImpl }).run("materiał B");
    expect(a.scopeHash).toBe(b.scopeHash);
    expect(a.scopeHash).not.toBe(c.scopeHash);
  });
});
