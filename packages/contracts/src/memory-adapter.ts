import { z } from "zod";

/**
 * MemoryAdapter 契约：Agent Runtime 通过此接口访问 Hub 记忆。
 * MVP 阶段用 MockMemoryAdapter（recall 返回空数组），Hub API 就绪后接真实实现。
 */

export const memoryFragmentSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  room: z.string().min(1),
  relevance_score: z.number().min(0).max(1),
  created_at: z.string().datetime(),
});
export type MemoryFragment = z.infer<typeof memoryFragmentSchema>;

export const privateNoteSchema = z.object({
  id: z.string().min(1),
  ai_id: z.string().min(1),
  content: z.string().min(1),
  ttl_ms: z.number().int().positive().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PrivateNote = z.infer<typeof privateNoteSchema>;

export const personContextViewSchema = z.object({
  memories: z.array(memoryFragmentSchema),
  private_notes: z.array(privateNoteSchema),
  recent_events_summary: z.string().optional(),
});
export type PersonContextView = z.infer<typeof personContextViewSchema>;

export const memoryRecallRequestSchema = z.object({
  agent_id: z.string().min(1),
  scene_id: z.string().min(1).optional(),
  conversation_id: z.string().min(1).optional(),
  query: z.string().optional(),
  max_fragments: z.number().int().positive().optional(),
});
export type MemoryRecallRequest = z.infer<typeof memoryRecallRequestSchema>;

/**
 * MemoryAdapter 接口：Runtime 访问 Hub 记忆的唯一通道。
 */
export interface MemoryAdapter {
  recall(request: MemoryRecallRequest): Promise<PersonContextView>;
}
