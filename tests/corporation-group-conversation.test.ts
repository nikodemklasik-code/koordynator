import { describe, expect, it } from "vitest";
import {
  GroupConversation,
  type GroupConversationParticipant
} from "../src/corporation/group-conversation.js";

function participant(
  index: number,
  overrides: Partial<GroupConversationParticipant> = {}
): GroupConversationParticipant {
  return {
    participantId: `agent-${String(index).padStart(3, "0")}`,
    displayName: `Agent ${String(index).padStart(3, "0")}`,
    participationRole: "CONTRIBUTOR",
    departmentId: index % 2 === 0 ? "DEPT-PRODUCT" : "DEPT-LEGAL",
    roleId: `ROLE-${index}`,
    agentId: `AGENT-${index}`,
    modelId: `model-${index}`,
    sourceSessionId: `session-${index}`,
    knowledge: {
      mode: "SOURCE_AND_SHARED",
      allowedLabels: ["GENERAL"],
      allowedKnowledgePackageIds: ["KPACK-GENERAL"]
    },
    canSpeak: true,
    active: true,
    ...overrides
  };
}

describe("Corporation group conversation", () => {
  it("has no arbitrary participant-count ceiling", () => {
    const participants = Array.from({ length: 64 }, (_, index) => participant(index + 1));
    const conversation = new GroupConversation("GROUP-64", participants);

    expect(conversation.participants()).toHaveLength(64);
    expect(conversation.currentSpeaker().participantId).toBe("agent-001");
  });

  it("keeps knowledge visibility participant-scoped", () => {
    const product = participant(1, {
      participantId: "product",
      displayName: "Product",
      departmentId: "DEPT-PRODUCT",
      knowledge: {
        mode: "LABELLED",
        allowedLabels: ["PRODUCT", "GENERAL"],
        allowedKnowledgePackageIds: ["KPACK-PRODUCT"]
      }
    });
    const legal = participant(2, {
      participantId: "legal",
      displayName: "Legal",
      departmentId: "DEPT-LEGAL",
      knowledge: {
        mode: "LABELLED",
        allowedLabels: ["LEGAL", "GENERAL"],
        allowedKnowledgePackageIds: ["KPACK-LEGAL"]
      }
    });

    const conversation = new GroupConversation("GROUP-SCOPE", [legal, product]);
    const first = conversation.currentSpeaker();
    expect(first.participantId).toBe("legal");

    const { message } = conversation.postTurn({
      participantId: "legal",
      content: "Privileged legal review",
      visibility: { kind: "LABELLED", labels: ["LEGAL"] },
      knowledgePackageIds: ["KPACK-LEGAL"],
      hllBindingRefs: ["HLL:LEGAL:1"]
    });

    expect(conversation.projectMessage("legal", message).visible).toBe(true);
    expect(conversation.projectMessage("product", message)).toMatchObject({
      visible: false,
      redactionReason: "VISIBILITY_SCOPE_DENIED"
    });
  });

  it("freezes membership during a round and activates staged joins at the next boundary", () => {
    const alpha = participant(1, { participantId: "alpha", displayName: "Alpha" });
    const beta = participant(2, { participantId: "beta", displayName: "Beta" });
    const gamma = participant(3, { participantId: "gamma", displayName: "Gamma" });

    const conversation = new GroupConversation("GROUP-MEMBERSHIP", [alpha, beta]);
    conversation.stageMembership([alpha, beta, gamma]);

    expect(conversation.participants()).toHaveLength(2);

    conversation.postTurn({ participantId: "alpha", content: "A" });
    expect(conversation.participants()).toHaveLength(2);

    conversation.postTurn({ participantId: "beta", content: "B" });
    expect(conversation.participants()).toHaveLength(3);
    expect(conversation.currentSpeaker().participantId).toBe("alpha");
  });

  it("lets observers participate in knowledge flow without giving them a speaking turn", () => {
    const alpha = participant(1, { participantId: "alpha", displayName: "Alpha" });
    const observer = participant(2, {
      participantId: "observer",
      displayName: "Observer",
      participationRole: "OBSERVER",
      canSpeak: false
    });

    const conversation = new GroupConversation("GROUP-OBSERVER", [alpha, observer]);
    expect(conversation.currentSpeaker().participantId).toBe("alpha");

    const { message } = conversation.postTurn({
      participantId: "alpha",
      content: "Shared result",
      visibility: { kind: "SHARED" }
    });

    expect(conversation.projectMessage("observer", message).visible).toBe(true);
    expect(conversation.currentSpeaker().participantId).toBe("alpha");
  });

  it("hash-chains the conversation ledger independently from model text claims", () => {
    const alpha = participant(1, { participantId: "alpha", displayName: "Alpha" });
    const beta = participant(2, { participantId: "beta", displayName: "Beta" });
    const conversation = new GroupConversation("GROUP-LEDGER", [alpha, beta]);

    const first = conversation.postTurn({ participantId: "alpha", content: "First" }).message;
    const second = conversation.postTurn({ participantId: "beta", content: "Second" }).message;

    expect(first.previousMessageHash).toBeNull();
    expect(second.previousMessageHash).toBe(first.messageHash);
    expect(second.messageHash).not.toBe(first.messageHash);
  });
});
