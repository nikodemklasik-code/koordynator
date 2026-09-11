// Harmonia — Etap 0 "samotne poznanie": pierwsze czytanie źródła.
//
// Harmonia jako pierwsza i jedyna wchłania cały projekt z błędami. Zanim można
// orzec podział pracy, źródło musi zostać przeczytane w całości i deterministycznie.
// Ten moduł buduje plan czytania — nie ocenia treści (to robi brama Etapu 0).
//
// Kontrakt czytania:
// - źródło tnie się na całe segmenty po SEGMENT_WORDS słów (bez gubienia słów),
// - materiał fundamentalny (spec/kanon/brief) czyta się od brzegów do środka
//   dwoma zespołami (A od krawędzi, B środek) — model operatora 1,3 -> 2,
// - materiał rozproszony (kod/log/narracja) czyta się wg gęstości fundamentu,
// - domknięcia (seam passes) nakładają sąsiednie segmenty, by złapać sprzeczności
//   na granicach,
// - urwany ogon ("..."/"…") => źródło niedomknięte (read_not_closed po stronie bramy).

export const SEGMENT_WORDS = 395;

export type ReadingSegment = {
  index: number;
  text: string;
  /** Gęstość fundamentu w segmencie (definicje, byty, niezmienniki). 0..1. */
  weight?: number;
};

export type ReadingStrategy = "edges-first" | "dependency-first" | "linear";

export type ReadingTeam = "A" | "B";

export type ReadingStep = {
  index: number;
  team: ReadingTeam;
};

export type SeamPass = {
  left: number;
  right: number;
  /** Nakładający się ogon lewego + głowa prawego segmentu (słowa). */
  overlap: string[];
};

export type SourceKind = "spec" | "canon" | "brief" | "code" | "log" | "narrative";

export type FirstReadingPlan = {
  segments: ReadingSegment[];
  strategy: ReadingStrategy;
  order: ReadingStep[];
  seams: SeamPass[];
  /** false gdy źródło ma urwany ogon — czytanie nie może zostać domknięte. */
  sourceClosed: boolean;
};

const EDGES_FIRST_KINDS = new Set<SourceKind>(["spec", "canon", "brief"]);
const SEAM_OVERLAP_WORDS = 20;

function tokenize(source: string): string[] {
  return source.split(/\s+/).filter(Boolean);
}

/** Tnie źródło na całe segmenty po SEGMENT_WORDS słów; nie gubi ani nie dubluje słów. */
export function segmentSource(source: string): ReadingSegment[] {
  const words = tokenize(source);
  if (words.length === 0) return [];
  const segments: ReadingSegment[] = [];
  for (let start = 0, index = 0; start < words.length; start += SEGMENT_WORDS, index += 1) {
    segments.push({ index, text: words.slice(start, start + SEGMENT_WORDS).join(" ") });
  }
  return segments;
}

// Brzegi absolutne (pierwszy i ostatni segment) bierze zespół A — to on rusza od
// krawędzi. Wszystko pomiędzy domyka zespół B. Fundament specu/kanonu siedzi na
// samych brzegach, więc rozdział przebiega dokładnie na granicy brzeg/wnętrze.
function teamFor(index: number, count: number): ReadingTeam {
  return index === 0 || index === count - 1 ? "A" : "B";
}

// Zespół A czyta od obu krawędzi do środka, zespół B domyka środek:
// dla n segmentów kolejność to 0, n-1, 1, n-2, ... aż spotkają się w środku.
function planEdgesFirst(segments: ReadingSegment[]): ReadingStep[] {
  const count = segments.length;
  const order: ReadingStep[] = [];
  let left = 0;
  let right = count - 1;
  while (left < right) {
    order.push({ index: segments[left]!.index, team: teamFor(left, count) });
    order.push({ index: segments[right]!.index, team: teamFor(right, count) });
    left += 1;
    right -= 1;
  }
  if (left === right) order.push({ index: segments[left]!.index, team: teamFor(left, count) });
  return order;
}

// Fundament najpierw: segmenty o najwyższej wadze przed zależnymi, niezależnie
// od pozycji. Remis rozstrzyga kolejność źródłowa (deterministycznie, stabilnie).
function planDependencyFirst(segments: ReadingSegment[]): ReadingStep[] {
  return segments
    .map((segment, position) => ({ segment, position }))
    .sort((a, b) => (b.segment.weight ?? 0) - (a.segment.weight ?? 0) || a.position - b.position)
    .map(({ segment }): ReadingStep => ({ index: segment.index, team: "A" }));
}

export function planReadingOrder(segments: ReadingSegment[], strategy: ReadingStrategy): ReadingStep[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [{ index: segments[0]!.index, team: "A" }];
  if (strategy === "dependency-first") return planDependencyFirst(segments);
  if (strategy === "edges-first") return planEdgesFirst(segments);
  return segments.map((segment): ReadingStep => ({ index: segment.index, team: "A" }));
}

/** Domknięcia na granicach segmentów: nakładka ogona lewego i głowy prawego. */
export function seamPasses(segments: ReadingSegment[]): SeamPass[] {
  const seams: SeamPass[] = [];
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const left = segments[i]!;
    const right = segments[i + 1]!;
    const leftWords = tokenize(left.text);
    const rightWords = tokenize(right.text);
    seams.push({
      left: left.index,
      right: right.index,
      overlap: [...leftWords.slice(-SEAM_OVERLAP_WORDS), ...rightWords.slice(0, SEAM_OVERLAP_WORDS)]
    });
  }
  return seams;
}

export function selectReadingStrategy(input: { kind: SourceKind; segmentCount: number }): ReadingStrategy {
  if (input.segmentCount <= 1) return "linear";
  return EDGES_FIRST_KINDS.has(input.kind) ? "edges-first" : "dependency-first";
}

const OPEN_TAIL = /(\.\.\.|…)$/;

export function firstReading(source: string, input: { kind: SourceKind }): FirstReadingPlan {
  const sourceClosed = !OPEN_TAIL.test(source.trimEnd());
  const segments = segmentSource(source);
  const strategy = selectReadingStrategy({ kind: input.kind, segmentCount: segments.length });
  return {
    segments,
    strategy,
    order: planReadingOrder(segments, strategy),
    seams: seamPasses(segments),
    sourceClosed
  };
}
