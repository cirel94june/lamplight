import type { ContextEnvelope, ConversationKind } from "@lamplight/contracts";

export interface InternalMessage {
  content: string;
  sender_type: "user";
  context: ContextEnvelope;
  conversation_kind: ConversationKind;
  mentioned_agent_ids?: string[];
}

export interface WebClientPayload {
  content: string;
  mentioned_agent_ids?: string[];
}

export class LamplightWebAdapter {
  toInternal(
    payload: WebClientPayload,
    conversationKind: ConversationKind,
  ): InternalMessage {
    return {
      content: payload.content,
      sender_type: "user",
      context: {
        context_type: "out_of_world",
        set_by: "server",
      },
      conversation_kind: conversationKind,
      mentioned_agent_ids: payload.mentioned_agent_ids,
    };
  }
}
