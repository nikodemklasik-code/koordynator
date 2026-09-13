import type { ChatAttachment, ChatMessage, ChatSession } from "./chat-service.js";

export type ChatContextSelection = {
  responseIds: string[];
  attachmentIds: string[];
};

export type SelectedChatAttachment = {
  messageId: string;
  attachment: ChatAttachment;
};

export type SelectedChatContext = {
  responses: ChatMessage[];
  attachments: SelectedChatAttachment[];
};

export class ChatContextSelectionError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ChatContextSelectionError";
  }
}

const ITEM_ID_RE = /^[A-Za-z0-9._:-]{1,180}$/;
const MAX_SELECTED_ITEMS = 500;

function normalizeIds(value: unknown, field: "responseIds" | "attachmentIds"): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SELECTED_ITEMS) {
    throw new ChatContextSelectionError("CHAT_CONTEXT_SELECTION_INVALID", 400);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new ChatContextSelectionError("CHAT_CONTEXT_SELECTION_INVALID", 400);
    const id = raw.trim();
    if (!ITEM_ID_RE.test(id)) throw new ChatContextSelectionError("CHAT_CONTEXT_SELECTION_INVALID", 400);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  if (field === "responseIds" || field === "attachmentIds") return result;
  return result;
}

export function normalizeChatContextSelection(value: unknown): ChatContextSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChatContextSelectionError("CHAT_CONTEXT_SELECTION_INVALID", 400);
  }
  const record = value as Record<string, unknown>;
  return {
    responseIds: normalizeIds(record.responseIds, "responseIds"),
    attachmentIds: normalizeIds(record.attachmentIds, "attachmentIds")
  };
}

export function selectChatContext(session: ChatSession, selection: ChatContextSelection): SelectedChatContext {
  const eligibleResponses = new Map<string, ChatMessage>();
  const availableAttachments = new Map<string, SelectedChatAttachment>();

  for (const message of session.messages) {
    if (
      message.role === "assistant" &&
      (message.state === "complete" || message.state === "stopped") &&
      message.content.trim()
    ) {
      eligibleResponses.set(message.id, message);
    }
    for (const attachment of message.attachments ?? []) {
      availableAttachments.set(attachment.id, { messageId: message.id, attachment });
    }
  }

  const responses = selection.responseIds.map((id) => {
    const response = eligibleResponses.get(id);
    if (!response) throw new ChatContextSelectionError("CHAT_CONTEXT_RESPONSE_NOT_FOUND", 404);
    return response;
  });
  const attachments = selection.attachmentIds.map((id) => {
    const attachment = availableAttachments.get(id);
    if (!attachment) throw new ChatContextSelectionError("CHAT_CONTEXT_ATTACHMENT_NOT_FOUND", 404);
    return attachment;
  });

  return { responses, attachments };
}
