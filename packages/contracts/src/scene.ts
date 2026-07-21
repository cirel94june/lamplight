import { z } from "zod";

export const sceneDefinitionSchema = z.object({
  scene_id: z.string().min(1),
  display_name: z.string().min(1),
  type: z.string().min(1),
  prompt_weight_overrides: z.record(z.number().min(0).max(1)).default({}),
  max_participants: z.number().int().positive().nullish(),
  furniture_slots: z.number().int().nonnegative().nullish(),
  created_at: z.string().optional(),
});
export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;
