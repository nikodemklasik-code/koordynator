import { describe, expect, it } from "vitest";
import {
  concludeConversation,
  conversationSourceFingerprint,
  parseGroundedConclusionPayload,
  parseJsonObject
} from "../src/control/chat-conclusion.js";

const PLAN = [
  "PLAN UZGODNIONY",
  "Cel: Dodać ekran raportów do Koordynatora",
  "Moduły: reports",
  "Ścieżki: src/reports/**",
  "Kryteria akceptacji:",
  "- ekran renderuje listę raportów",
  "- test pokrywa pusty stan"
].join("\n");

describe("end-of-conversation conclusions", () => {
  it("turns explicit agreed plans into deterministic task candidates without model inference", () => {
    const messages = [
      { id: "m1", role: "user", content: "Potrzebuję raportów." },
      { id: "m2", role: "assistant", content: PLAN }
    ];

    const result = concludeConversation({ messages });

    expect(result.sourceFingerprint).toBe(conversationSourceFingerprint(messages));
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.objective).toBe("Dodać ekran raportów do Koordynatora");
    expect(result.tasks[0]?.allowedPaths).toEqual(["src/reports/**"]);
    expect(result.tasks[0]?.source).toBe("EXPLICIT_PLAN");
  });

  it("accepts model candidates only when evidence quotes are exact and repository paths were actually stated", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        content: "Zmieniamy src/chat/end.ts i test ma potwierdzić, że koniec rozmowy tworzy zadania."
      },
      {
        id: "a1",
        role: "assistant",
        content: "Moduł: chat. Kryterium: przycisk kończy rozmowę i zwraca listę zadań."
      }
    ];

    const valid = parseGroundedConclusionPayload({
      tasks: [{
        title: "Koniec rozmowy",
        objective: "Dodać zakończenie rozmowy z zadaniami",
        modules: ["chat"],
        allowedPaths: ["src/chat/end.ts"],
        acceptanceCriteria: ["przycisk kończy rozmowę i zwraca listę zadań"],
        evidence: [
          { messageId: "u1", quote: "Zmieniamy src/chat/end.ts" },
          { messageId: "a1", quote: "przycisk kończy rozmowę i zwraca listę zadań" }
        ]
      }]
    }, messages);

    expect(valid).toHaveLength(1);
    expect(valid[0]?.source).toBe("MODEL_GROUNDED");

    const invented = parseGroundedConclusionPayload({
      tasks: [{
        title: "Invented",
        objective: "Wymyślona zmiana",
        modules: ["chat"],
        allowedPaths: ["src/not-mentioned.ts"],
        acceptanceCriteria: ["wymyślone"],
        evidence: [{ messageId: "u1", quote: "tego cytatu nie ma" }]
      }]
    }, messages);

    expect(invented).toEqual([]);
  });

  it("parses fenced JSON but rejects prose without a JSON object", () => {
    expect(parseJsonObject('\\x60\\x60\\x60json\\n{"tasks":[]}\\n\\x60\\x60\\x60')).toEqual({ tasks: [] });
    expect(parseJsonObject("no structured result")).toBeNull();
  });
});
