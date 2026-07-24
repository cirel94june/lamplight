import { z } from "zod";
import { turnPolicySchema } from "./turn-policy.js";

export const sceneDefinitionSchema = z.object({
  scene_id: z.string().min(1),
  display_name: z.string().min(1),
  type: z.string().min(1),
  prompt_weight_overrides: z.record(z.number().min(0).max(1)).default({}),
  max_participants: z.number().int().positive().nullish(),
  furniture_slots: z.number().int().nonnegative().nullish(),
  default_turn_policy: turnPolicySchema.nullish(),
});
export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;
