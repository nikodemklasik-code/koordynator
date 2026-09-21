import { canonicalDigest } from "../crypto/canonical-digest.js";

export type GroupChatParticipant = {
  participantId: string;
  displayName: string;
  active?: boolean;
};

export type GroupChatTurnReceipt = {
  conversationId: string;
  round: number;
  turn: number;
  participantId: string;
  participantDisplayName: string;
  participantSnapshotHash: string;
  messageFingerprint: string;
  previousTurnReceiptHash: string | null;
  turnReceiptHash: string;
};

export type GroupChatQueueSnapshot = {
  conversationId: string;
  round: number;
  turn: number;
  currentParticipantId: string;
  orderedParticipantIds: string[];
  orderedDisplayNames: string[];
  participantSnapshotHash: string;
  pendingParticipantSnapshotHash: string;
  previousTurnReceiptHash: string | null;
};

type NormalizedParticipant = {
  participantId: string;
  displayName: string;
  sortKey: string;
};

function clean(value: string, code: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

/**
 * Language-neutral alphabet key:
 * NFKC(displayName), Unicode lower-case, then participantId as deterministic
 * tie-breaker. Sorting is by UTF-8 byte order, never process arrival time.
 */
function participantSortKey(participant: GroupChatParticipant): string {
  const name = clean(participant.displayName, "GROUP_CHAT_DISPLAY_NAME_REQUIRED");
  const participantId = clean(participant.participantId, "GROUP_CHAT_PARTICIPANT_ID_REQUIRED");
  return `${name.toLowerCase()}\u0000${participantId}`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function deterministicParticipantOrder(
  participants: GroupChatParticipant[]
): NormalizedParticipant[] {
  const active = participants
    .filter((participant) => participant.active !== false)
    .map((participant) => ({
      participantId: clean(participant.participantId, "GROUP_CHAT_PARTICIPANT_ID_REQUIRED"),
      displayName: clean(participant.displayName, "GROUP_CHAT_DISPLAY_NAME_REQUIRED"),
      sortKey: participantSortKey(participant)
    }));

  if (!active.length) throw new Error("GROUP_CHAT_PARTICIPANTS_REQUIRED");

  const ids = active.map((participant) => participant.participantId);
  if (new Set(ids).size !== ids.length) throw new Error("GROUP_CHAT_PARTICIPANT_ID_DUPLICATE");

  return active.sort((left, right) =>
    compareUtf8(left.sortKey, right.sortKey)
    || compareUtf8(left.participantId, right.participantId)
  );
}

function snapshotHash(participants: NormalizedParticipant[]): string {
  return canonicalDigest(participants.map((participant) => ({
    participantId: participant.participantId,
    displayName: participant.displayName,
    sortKey: participant.sortKey
  })));
}

/**
 * Deterministic round-robin queue for multi-agent group chat.
 *
 * Constitutional scheduling rule:
 *   alphabetical order -> last participant -> first participant -> repeat.
 *
 * "First response wins" is forbidden. A participant may speak only when its
 * deterministic turn is current. Membership changes are staged and take effect
 * only at the next round boundary, so a late join cannot jump the queue.
 */
export class DeterministicGroupChatQueue {
  private currentOrder: NormalizedParticipant[];
  private pendingOrder: NormalizedParticipant[];
  private currentIndex = 0;
  private roundNumber = 1;
  private turnNumber = 1;
  private previousTurnReceiptHash: string | null = null;

  constructor(
    private readonly conversationId: string,
    participants: GroupChatParticipant[]
  ) {
    if (!clean(conversationId, "GROUP_CHAT_CONVERSATION_ID_REQUIRED")) {
      throw new Error("GROUP_CHAT_CONVERSATION_ID_REQUIRED");
    }
    this.currentOrder = deterministicParticipantOrder(participants);
    this.pendingOrder = structuredClone(this.currentOrder);
  }

  snapshot(): GroupChatQueueSnapshot {
    const current = this.currentOrder[this.currentIndex]!;
    return {
      conversationId: this.conversationId,
      round: this.roundNumber,
      turn: this.turnNumber,
      currentParticipantId: current.participantId,
      orderedParticipantIds: this.currentOrder.map((participant) => participant.participantId),
      orderedDisplayNames: this.currentOrder.map((participant) => participant.displayName),
      participantSnapshotHash: snapshotHash(this.currentOrder),
      pendingParticipantSnapshotHash: snapshotHash(this.pendingOrder),
      previousTurnReceiptHash: this.previousTurnReceiptHash
    };
  }

  currentParticipant(): GroupChatParticipant {
    const current = this.currentOrder[this.currentIndex]!;
    return {
      participantId: current.participantId,
      displayName: current.displayName,
      active: true
    };
  }

  /**
   * Stage membership for the next complete alphabetic round.
   * The current round remains immutable.
   */
  stageParticipants(participants: GroupChatParticipant[]): void {
    this.pendingOrder = deterministicParticipantOrder(participants);
  }

  assertTurn(participantId: string): void {
    const expected = this.currentOrder[this.currentIndex]!;
    if (clean(participantId, "GROUP_CHAT_PARTICIPANT_ID_REQUIRED") !== expected.participantId) {
      throw new Error(`GROUP_CHAT_OUT_OF_TURN:expected=${expected.participantId}`);
    }
  }

  completeTurn(input: {
    participantId: string;
    messageFingerprint: string;
  }): GroupChatTurnReceipt {
    this.assertTurn(input.participantId);
    const messageFingerprint = clean(
      input.messageFingerprint,
      "GROUP_CHAT_MESSAGE_FINGERPRINT_REQUIRED"
    );
    const current = this.currentOrder[this.currentIndex]!;
    const base = {
      conversationId: this.conversationId,
      round: this.roundNumber,
      turn: this.turnNumber,
      participantId: current.participantId,
      participantDisplayName: current.displayName,
      participantSnapshotHash: snapshotHash(this.currentOrder),
      messageFingerprint,
      previousTurnReceiptHash: this.previousTurnReceiptHash
    };
    const receipt: GroupChatTurnReceipt = {
      ...base,
      turnReceiptHash: canonicalDigest(base)
    };

    this.previousTurnReceiptHash = receipt.turnReceiptHash;
    this.turnNumber += 1;
    this.currentIndex += 1;

    if (this.currentIndex >= this.currentOrder.length) {
      this.roundNumber += 1;
      this.currentIndex = 0;
      this.currentOrder = structuredClone(this.pendingOrder);
    }

    return receipt;
  }
}
