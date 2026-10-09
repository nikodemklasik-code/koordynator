import { canonicalDigest } from "../crypto/canonical-digest.js";
import {
  DeterministicGroupChatQueue,
  type GroupChatParticipant,
  type GroupChatTurnReceipt
} from "./group-chat-queue.js";

export type GroupParticipationRole =
  | "OBSERVER"
  | "CONTRIBUTOR"
  | "SPECIALIST"
  | "REVIEWER"
  | "DECISION_SUPPORT"
  | "EXECUTOR"
  | "QC"
  | "MODERATOR";

export type GroupKnowledgeMode =
  | "SHARED_ONLY"
  | "SOURCE_AND_SHARED"
  | "LABELLED"
  | "DIRECT_ONLY";

export type GroupConversationParticipant = {
  participantId: string;
  displayName: string;
  participationRole: GroupParticipationRole;
  departmentId?: string;
  roleId?: string;
  agentId?: string;
  modelId?: string;
  sourceSessionId?: string;
  knowledge: {
    mode: GroupKnowledgeMode;
    allowedLabels: string[];
    allowedKnowledgePackageIds: string[];
  };
  canSpeak: boolean;
  active: boolean;
};

export type GroupMessageVisibility =
  | { kind: "SHARED" }
  | { kind: "DIRECT"; participantIds: string[] }
  | { kind: "DEPARTMENT"; departmentId: string }
  | { kind: "LABELLED"; labels: string[] };

export type GroupConversationMessage = {
  messageId: string;
  conversationId: string;
  authorParticipantId: string;
  content: string;
  contentFingerprint: string;
  visibility: GroupMessageVisibility;
  knowledgePackageIds: string[];
  hllBindingRefs: string[];
  createdAt: string;
  previousMessageHash: string | null;
  messageHash: string;
};

export type GroupMessageProjection = {
  participantId: string;
  visible: boolean;
  message?: GroupConversationMessage;
  redactionReason?: string;
};

function clean(value: string, code: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizedParticipant(
  input: GroupConversationParticipant
): GroupConversationParticipant {
  return {
    ...input,
    participantId: clean(input.participantId, "GROUP_PARTICIPANT_ID_REQUIRED"),
    displayName: clean(input.displayName, "GROUP_PARTICIPANT_NAME_REQUIRED"),
    knowledge: {
      mode: input.knowledge.mode,
      allowedLabels: [...new Set(input.knowledge.allowedLabels.map((value) => clean(value, "GROUP_KNOWLEDGE_LABEL_INVALID")))].sort(),
      allowedKnowledgePackageIds: [...new Set(input.knowledge.allowedKnowledgePackageIds.map((value) => clean(value, "GROUP_KNOWLEDGE_PACKAGE_INVALID")))].sort()
    }
  };
}

function queueParticipants(
  participants: Map<string, GroupConversationParticipant>
): GroupChatParticipant[] {
  return [...participants.values()].map((participant) => ({
    participantId: participant.participantId,
    displayName: participant.displayName,
    active: participant.active && participant.canSpeak
  }));
}

function participantMap(
  participants: GroupConversationParticipant[]
): Map<string, GroupConversationParticipant> {
  const map = new Map<string, GroupConversationParticipant>();
  for (const participant of participants.map(normalizedParticipant)) {
    if (map.has(participant.participantId)) {
      throw new Error("GROUP_PARTICIPANT_ID_DUPLICATE");
    }
    map.set(participant.participantId, participant);
  }
  if (!map.size) throw new Error("GROUP_PARTICIPANTS_REQUIRED");
  return map;
}

function messageHashBase(message: Omit<GroupConversationMessage, "messageHash">) {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    authorParticipantId: message.authorParticipantId,
    contentFingerprint: message.contentFingerprint,
    visibility: message.visibility,
    knowledgePackageIds: [...message.knowledgePackageIds].sort(),
    hllBindingRefs: [...message.hllBindingRefs].sort(),
    createdAt: message.createdAt,
    previousMessageHash: message.previousMessageHash
  };
}

function visibilityAllows(
  participant: GroupConversationParticipant,
  visibility: GroupMessageVisibility
): boolean {
  if (visibility.kind === "SHARED") {
    return participant.knowledge.mode !== "DIRECT_ONLY";
  }
  if (visibility.kind === "DIRECT") {
    return visibility.participantIds.includes(participant.participantId);
  }
  if (visibility.kind === "DEPARTMENT") {
    return participant.departmentId === visibility.departmentId;
  }
  if (participant.knowledge.mode !== "LABELLED" && participant.knowledge.mode !== "SOURCE_AND_SHARED") {
    return false;
  }
  const allowed = new Set(participant.knowledge.allowedLabels);
  return visibility.labels.every((label) => allowed.has(label));
}

function knowledgePackagesAllow(
  participant: GroupConversationParticipant,
  packageIds: string[]
): boolean {
  if (!packageIds.length) return true;
  const allowed = new Set(participant.knowledge.allowedKnowledgePackageIds);
  return packageIds.every((packageId) => allowed.has(packageId));
}

/**
 * Corporation group-conversation core.
 *
 * There is deliberately no participant-count constant. Membership size is a
 * runtime/resource concern, not an arbitrary constitutional limit. Knowledge
 * visibility and speaking authority remain per-participant.
 */
export class GroupConversation {
  private currentParticipants: Map<string, GroupConversationParticipant>;
  private pendingParticipants: Map<string, GroupConversationParticipant>;
  private readonly queue: DeterministicGroupChatQueue;
  private readonly messages: GroupConversationMessage[] = [];
  private previousMessageHash: string | null = null;

  constructor(
    readonly conversationId: string,
    participants: GroupConversationParticipant[]
  ) {
    clean(conversationId, "GROUP_CONVERSATION_ID_REQUIRED");
    this.currentParticipants = participantMap(participants);
    this.pendingParticipants = new Map(
      [...this.currentParticipants.entries()].map(([id, participant]) => [id, structuredClone(participant)])
    );
    this.queue = new DeterministicGroupChatQueue(
      conversationId,
      queueParticipants(this.currentParticipants)
    );
  }

  participants(): GroupConversationParticipant[] {
    return [...this.currentParticipants.values()].map((participant) => structuredClone(participant));
  }

  pendingMembership(): GroupConversationParticipant[] {
    return [...this.pendingParticipants.values()].map((participant) => structuredClone(participant));
  }

  stageMembership(participants: GroupConversationParticipant[]): void {
    const pending = participantMap(participants);
    const speakers = queueParticipants(pending).filter((participant) => participant.active !== false);
    if (!speakers.length) throw new Error("GROUP_ACTIVE_SPEAKER_REQUIRED");
    this.pendingParticipants = pending;
    this.queue.stageParticipants(queueParticipants(pending));
  }

  currentSpeaker(): GroupConversationParticipant {
    const current = this.queue.currentParticipant();
    const contract = this.currentParticipants.get(current.participantId);
    if (!contract) throw new Error("GROUP_SPEAKER_CONTRACT_MISSING");
    return structuredClone(contract);
  }

  postTurn(input: {
    participantId: string;
    content: string;
    visibility?: GroupMessageVisibility;
    knowledgePackageIds?: string[];
    hllBindingRefs?: string[];
    createdAt?: string;
  }): {
    turnReceipt: GroupChatTurnReceipt;
    message: GroupConversationMessage;
  } {
    const participantId = clean(input.participantId, "GROUP_PARTICIPANT_ID_REQUIRED");
    const participant = this.currentParticipants.get(participantId);
    if (!participant || !participant.active) throw new Error("GROUP_PARTICIPANT_INACTIVE");
    if (!participant.canSpeak) throw new Error("GROUP_PARTICIPANT_CANNOT_SPEAK");

    const content = clean(input.content, "GROUP_MESSAGE_CONTENT_REQUIRED");
    const visibility = input.visibility ?? { kind: "SHARED" };
    const knowledgePackageIds = [...new Set(input.knowledgePackageIds ?? [])].sort();
    const hllBindingRefs = [...new Set(input.hllBindingRefs ?? [])].sort();

    const contentFingerprint = canonicalDigest(content);
    const beforeRound = this.queue.snapshot().round;
    const turnReceipt = this.queue.completeTurn({
      participantId,
      messageFingerprint: contentFingerprint
    });

    const base: Omit<GroupConversationMessage, "messageHash"> = {
      messageId: `GMSG-${turnReceipt.round}-${turnReceipt.turn}-${contentFingerprint.slice(-12)}`,
      conversationId: this.conversationId,
      authorParticipantId: participantId,
      content,
      contentFingerprint,
      visibility,
      knowledgePackageIds,
      hllBindingRefs,
      createdAt: input.createdAt ?? new Date().toISOString(),
      previousMessageHash: this.previousMessageHash
    };
    const message: GroupConversationMessage = {
      ...base,
      messageHash: canonicalDigest(messageHashBase(base))
    };
    this.messages.push(message);
    this.previousMessageHash = message.messageHash;

    if (this.queue.snapshot().round !== beforeRound) {
      this.currentParticipants = new Map(
        [...this.pendingParticipants.entries()].map(([id, contract]) => [id, structuredClone(contract)])
      );
    }

    return {
      turnReceipt,
      message: structuredClone(message)
    };
  }

  projectMessage(
    participantId: string,
    message: GroupConversationMessage
  ): GroupMessageProjection {
    const participant = this.currentParticipants.get(participantId)
      ?? this.pendingParticipants.get(participantId);
    if (!participant || !participant.active) {
      return { participantId, visible: false, redactionReason: "PARTICIPANT_INACTIVE_OR_UNKNOWN" };
    }
    if (message.authorParticipantId === participantId) {
      return { participantId, visible: true, message: structuredClone(message) };
    }
    if (!visibilityAllows(participant, message.visibility)) {
      return { participantId, visible: false, redactionReason: "VISIBILITY_SCOPE_DENIED" };
    }
    if (!knowledgePackagesAllow(participant, message.knowledgePackageIds)) {
      return { participantId, visible: false, redactionReason: "KNOWLEDGE_PACKAGE_DENIED" };
    }
    return { participantId, visible: true, message: structuredClone(message) };
  }

  ledger(): GroupConversationMessage[] {
    return this.messages.map((message) => structuredClone(message));
  }
}
