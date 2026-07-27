import { eq, desc } from "drizzle-orm";
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
      .orderBy(desc(schema.messages.created_at))
      .limit(limit);
    return rows.reverse();
  }

  async createMessage(data: typeof schema.messages.$inferInsert) {
    await this.db.insert(schema.messages).values(data);
  }
}
