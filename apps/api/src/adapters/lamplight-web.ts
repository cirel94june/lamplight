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
    let mentionedAgentIds: string[] | undefined;
    if (payload.mentioned_agent_ids !== undefined) {
      if (
        !Array.isArray(payload.mentioned_agent_ids) ||
        !payload.mentioned_agent_ids.every((v): v is string => typeof v === "string")
      ) {
        throw new TypeError("mentioned_agent_ids must be a string array");
      }
      if (payload.mentioned_agent_ids.some((v) => v.trim().length === 0)) {
        throw new TypeError("mentioned_agent_ids must not contain empty strings");
      }
      mentionedAgentIds = payload.mentioned_agent_ids;
    }

    return {
      content: payload.content,
      sender_type: "user",
      context: {
        context_type: "out_of_world",
        set_by: "server",
      },
      conversation_kind: conversationKind,
      mentioned_agent_ids: mentionedAgentIds,
    };
  }
}
