import { describe, expect, it } from "vitest";
import {
  segmentSource,
  planReadingOrder,
  seamPasses,
  selectReadingStrategy,
  firstReading,
  SEGMENT_WORDS,
  type ReadingSegment
} from "../src/domain/harmonia-reading.js";

function words(n: number, tag: string): string {
  return Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
}

describe("Harmonia first reading — segmentation", () => {
  it("keeps the canonical 395-word segment contract", () => {
    expect(SEGMENT_WORDS).toBe(395);
  });

  it("splits a long source into whole 395-word segments without dropping words", () => {
    const source = words(1000, "w");
    const segments = segmentSource(source);
    expect(segments.length).toBe(3);
    const rejoined = segments.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean);
    expect(rejoined.length).toBe(1000);
    expect(segments[0]!.index).toBe(0);
    expect(segments.at(-1)!.index).toBe(2);
  });

  it("treats a short source as a single segment", () => {
    expect(segmentSource(words(50, "s")).length).toBe(1);
    expect(segmentSource("").length).toBe(0);
  });
});

describe("Harmonia first reading — edges-first order (operator model 1,3 -> 2)", () => {
  it("reads the edges first, then the middle, alternating team A (edges) and team B (middle)", () => {
    const segments = segmentSource(words(395 * 5, "w")); // 5 segments: 0..4
    const order = planReadingOrder(segments, "edges-first");
    // team A reads brzegi from both ends inward; team B reads the middle.
    expect(order.map((step) => step.index)).toEqual([0, 4, 1, 3, 2]);
    expect(order[0]!.team).toBe("A");
    expect(order[1]!.team).toBe("A");
    expect(order[2]!.team).toBe("B");
    expect(order.at(-1)!.index).toBe(2); // meet in the middle last
  });

  it("degrades to a single step for one segment", () => {
    const order = planReadingOrder(segmentSource(words(10, "w")), "edges-first");
    expect(order.map((s) => s.index)).toEqual([0]);
  });
});

describe("Harmonia first reading — dependency-first order (general)", () => {
  it("reads foundation-dense segments before dependent ones regardless of position", () => {
    const segments: ReadingSegment[] = [
      { index: 0, text: "narrative detail", weight: 0.1 },
      { index: 1, text: "definicja: byt X to ...", weight: 0.9 },
      { index: 2, text: "more detail", weight: 0.2 }
    ];
    const order = planReadingOrder(segments, "dependency-first");
    expect(order[0]!.index).toBe(1); // highest weight (foundation) first
  });
});

describe("Harmonia first reading — seam passes across segment borders", () => {
  it("emits closing passes that overlap adjacent segments so cross-border contradictions are caught", () => {
    const segments = segmentSource(words(395 * 3, "w"));
    const seams = seamPasses(segments);
    expect(seams.length).toBe(2); // borders between 0-1 and 1-2
    expect(seams[0]!.left).toBe(0);
    expect(seams[0]!.right).toBe(1);
    expect(seams[0]!.overlap.length).toBeGreaterThan(0);
  });

  it("has no seam pass for a single segment", () => {
    expect(seamPasses(segmentSource(words(10, "w"))).length).toBe(0);
  });
});

describe("Harmonia first reading — strategy selection", () => {
  it("chooses edges-first for spec/canon/brief material where the fundament sits at the edges", () => {
    expect(selectReadingStrategy({ kind: "spec", segmentCount: 5 })).toBe("edges-first");
    expect(selectReadingStrategy({ kind: "canon", segmentCount: 5 })).toBe("edges-first");
  });

  it("chooses dependency-first for code/log/narrative where sense is spread or central", () => {
    expect(selectReadingStrategy({ kind: "code", segmentCount: 5 })).toBe("dependency-first");
    expect(selectReadingStrategy({ kind: "log", segmentCount: 5 })).toBe("dependency-first");
  });

  it("skips the ceremony and reads linearly when the source fits one segment", () => {
    expect(selectReadingStrategy({ kind: "spec", segmentCount: 1 })).toBe("linear");
  });
});

describe("Harmonia first reading — full plan is deterministic and complete", () => {
  it("covers every segment exactly once in the reading order and reports open tail", () => {
    const plan = firstReading(words(395 * 4, "w") + " ...", { kind: "spec" });
    const covered = new Set(plan.order.map((s) => s.index));
    expect(covered.size).toBe(plan.segments.length);
    expect(plan.strategy).toBe("edges-first");
    expect(plan.sourceClosed).toBe(false); // trailing ... means read not closed
    expect(plan.seams.length).toBe(plan.segments.length - 1);
  });

  it("marks source closed when there is no open tail", () => {
    const plan = firstReading(words(30, "w"), { kind: "spec" });
    expect(plan.sourceClosed).toBe(true);
    expect(plan.strategy).toBe("linear");
  });
});
