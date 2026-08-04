import { eq, desc, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "../../db/schema.js";

export class ConversationRepository {
  constructor(private db: LibSQLDatabase<typeof schema>) {}

  async getConversation(id: string) {
    const rows = await this.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async createConversation(data: typeof schema.conversations.$inferInsert) {
    await this.db.insert(schema.conversations).values(data);
  }

  async getRecentMessages(conversationId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversation_id, conversationId))
      .orderBy(desc(schema.messages.seq))
      .limit(limit);
    return rows.reverse();
  }

  async createMessage(data: typeof schema.messages.$inferInsert) {
    const promptSnapshot = data.prompt_snapshot ? JSON.stringify(data.prompt_snapshot) : null;
    await this.db.run(sql`
      INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_world_id, context_session_id, context_branch_id, context_set_by, speech_mode, prompt_snapshot, usage_input_tokens, usage_output_tokens, created_at)
      VALUES (
        ${data.id},
        ${data.conversation_id},
        ${data.conversation_kind},
        (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ${data.conversation_id}),
        ${data.sender_type},
        ${data.sender_ai_id ?? null},
        ${data.content},
        ${data.context_type},
        ${data.context_world_id ?? null},
        ${data.context_session_id ?? null},
        ${data.context_branch_id ?? null},
        ${data.context_set_by ?? "server"},
        ${data.speech_mode ?? null},
        ${promptSnapshot},
        ${data.usage_input_tokens ?? null},
        ${data.usage_output_tokens ?? null},
        ${data.created_at}
      )
    `);
  }
}
