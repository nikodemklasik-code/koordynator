import { describe, expect, it } from "vitest";
import { DeterministicGroupChatQueue } from "../src/corporation/group-chat-queue.js";

describe("deterministic Corporation group-chat queue", () => {
  it("uses alphabetic order, wraps after the last participant and ignores arrival order", () => {
    const queue = new DeterministicGroupChatQueue("CHAT-1", [
      { participantId: "agent-z", displayName: "Zulu" },
      { participantId: "agent-a", displayName: "Alpha" },
      { participantId: "agent-m", displayName: "Mike" }
    ]);

    expect(queue.snapshot().orderedDisplayNames).toEqual(["Alpha", "Mike", "Zulu"]);
    expect(queue.currentParticipant().displayName).toBe("Alpha");

    queue.completeTurn({ participantId: "agent-a", messageFingerprint: "m1" });
    expect(queue.currentParticipant().displayName).toBe("Mike");

    queue.completeTurn({ participantId: "agent-m", messageFingerprint: "m2" });
    expect(queue.currentParticipant().displayName).toBe("Zulu");

    queue.completeTurn({ participantId: "agent-z", messageFingerprint: "m3" });
    expect(queue.currentParticipant().displayName).toBe("Alpha");
    expect(queue.snapshot().round).toBe(2);
  });

  it("rejects whoever replies first when it is not their deterministic turn", () => {
    const queue = new DeterministicGroupChatQueue("CHAT-2", [
      { participantId: "b", displayName: "Beta" },
      { participantId: "a", displayName: "Alpha" }
    ]);

    expect(() => queue.completeTurn({
      participantId: "b",
      messageFingerprint: "fast-but-out-of-turn"
    })).toThrow("GROUP_CHAT_OUT_OF_TURN:expected=a");

    expect(queue.currentParticipant().participantId).toBe("a");
  });

  it("freezes membership for the current round and applies joins/leaves only next round", () => {
    const queue = new DeterministicGroupChatQueue("CHAT-3", [
      { participantId: "a", displayName: "Alpha" },
      { participantId: "c", displayName: "Charlie" }
    ]);

    queue.stageParticipants([
      { participantId: "b", displayName: "Bravo" },
      { participantId: "c", displayName: "Charlie" }
    ]);

    expect(queue.snapshot().orderedDisplayNames).toEqual(["Alpha", "Charlie"]);

    queue.completeTurn({ participantId: "a", messageFingerprint: "m1" });
    expect(queue.currentParticipant().participantId).toBe("c");

    queue.completeTurn({ participantId: "c", messageFingerprint: "m2" });

    expect(queue.snapshot().round).toBe(2);
    expect(queue.snapshot().orderedDisplayNames).toEqual(["Bravo", "Charlie"]);
    expect(queue.currentParticipant().participantId).toBe("b");
  });

  it("uses participant id as deterministic tie-breaker for identical display names", () => {
    const queue = new DeterministicGroupChatQueue("CHAT-4", [
      { participantId: "agent-2", displayName: "Auditor" },
      { participantId: "agent-1", displayName: "Auditor" }
    ]);

    expect(queue.snapshot().orderedParticipantIds).toEqual(["agent-1", "agent-2"]);
  });

  it("hash-chains accepted turns so queue history is tamper-evident", () => {
    const queue = new DeterministicGroupChatQueue("CHAT-5", [
      { participantId: "a", displayName: "Alpha" },
      { participantId: "b", displayName: "Beta" }
    ]);

    const first = queue.completeTurn({ participantId: "a", messageFingerprint: "m1" });
    const second = queue.completeTurn({ participantId: "b", messageFingerprint: "m2" });

    expect(first.previousTurnReceiptHash).toBeNull();
    expect(second.previousTurnReceiptHash).toBe(first.turnReceiptHash);
  });
});
