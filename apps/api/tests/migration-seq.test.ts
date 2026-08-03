import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";

describe("Migration 0005: message seq", () => {
  const client = createClient({ url: ":memory:" });
  const testDb = drizzle(client);

  beforeAll(async () => {
    // Create pre-0005 schema (no seq column)
    await testDb.run(sql`CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL,
      conversation_kind TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_ai_id TEXT,
      content TEXT NOT NULL,
      context_type TEXT NOT NULL,
      context_world_id TEXT,
      context_session_id TEXT,
      context_branch_id TEXT,
      context_set_by TEXT NOT NULL DEFAULT 'server',
      speech_mode TEXT,
      prompt_snapshot TEXT,
      created_at TEXT NOT NULL
    )`);

    // Pre-existing messages at same timestamp
    const sameTime = "2026-08-01T12:00:00.000Z";
    await testDb.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, sender_type, content, context_type, context_set_by, created_at) VALUES
      ('msg-a1', 'conv-a', 'house_chat', 'user', 'question', 'out_of_world', 'server', ${sameTime})`);
    await testDb.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES
      ('msg-a2', 'conv-a', 'house_chat', 'ai', 'jasper', 'answer', 'out_of_world', 'server', ${sameTime})`);
    await testDb.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, sender_type, content, context_type, context_set_by, created_at) VALUES
      ('msg-b1', 'conv-b', 'house_chat', 'user', 'hello', 'out_of_world', 'server', ${sameTime})`);

    // Apply 0005 migration steps
    await testDb.run(sql`ALTER TABLE messages ADD seq integer NOT NULL DEFAULT 0`);
    await testDb.run(sql`UPDATE messages SET seq = (
      SELECT COUNT(*) FROM messages m2
      WHERE m2.conversation_id = messages.conversation_id
      AND m2.rowid <= messages.rowid
    )`);
    await testDb.run(sql`CREATE UNIQUE INDEX idx_messages_conv_seq ON messages(conversation_id, seq)`);
  });

  it("seq column exists after migration", async () => {
    const cols = await testDb.all<{ name: string }>(
      sql`PRAGMA table_info(messages)`,
    );
    const seqCol = cols.find((c) => c.name === "seq");
    expect(seqCol).toBeDefined();
  });

  it("backfills old messages with monotonic seq per conversation", async () => {
    const convA = await testDb.all<{ id: string; seq: number }>(
      sql`SELECT id, seq FROM messages WHERE conversation_id = 'conv-a' ORDER BY seq`,
    );
    expect(convA).toHaveLength(2);
    expect(convA[0].seq).toBe(1);
    expect(convA[1].seq).toBe(2);
    // Insertion order preserved: question before answer
    expect(convA[0].id).toBe("msg-a1");
    expect(convA[1].id).toBe("msg-a2");

    // conv-b has independent counter
    const convB = await testDb.all<{ id: string; seq: number }>(
      sql`SELECT id, seq FROM messages WHERE conversation_id = 'conv-b' ORDER BY seq`,
    );
    expect(convB).toHaveLength(1);
    expect(convB[0].seq).toBe(1);
  });

  it("unique constraint prevents duplicate seq within conversation", async () => {
    await expect(
      testDb.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at) VALUES
        ('msg-dup', 'conv-a', 'house_chat', 1, 'user', 'duplicate', 'out_of_world', 'server', '2026-08-01T12:00:00.000Z')`),
    ).rejects.toThrow();
  });

  it("atomic seq assignment produces unique values under concurrent writes", async () => {
    const convId = "conv-concurrent";

    const promises = Array.from({ length: 20 }, (_, i) =>
      testDb.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at) VALUES (
        ${`msg-conc-${i}`},
        ${convId},
        'house_chat',
        (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ${convId}),
        'user',
        ${`msg ${i}`},
        'out_of_world',
        'server',
        '2026-08-01T12:00:00.000Z'
      )`),
    );

    await Promise.all(promises);

    const rows = await testDb.all<{ seq: number }>(
      sql`SELECT seq FROM messages WHERE conversation_id = ${convId} ORDER BY seq`,
    );

    expect(rows).toHaveLength(20);
    const seqs = rows.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(20);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(20);
  });
});
