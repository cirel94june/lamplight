import type { SceneDefinition } from "@lamplight/contracts";

export const ROOMS: SceneDefinition[] = [
  {
    scene_id: "room-ceci-bedroom",
    display_name: "小猫卧室",
    type: "room",
    prompt_weight_overrides: { intimacy: 0.3 },
  },
  {
    scene_id: "room-xiaoke-bedroom",
    display_name: "小克卧室",
    type: "room",
    prompt_weight_overrides: { creativity: 0.25 },
  },
  {
    scene_id: "room-lucien-bedroom",
    display_name: "Lucien 卧室",
    type: "room",
    prompt_weight_overrides: { philosophy: 0.3 },
  },
  {
    scene_id: "room-jasper-bedroom",
    display_name: "Jasper 卧室",
    type: "room",
    prompt_weight_overrides: { adventure: 0.25 },
  },
  {
    scene_id: "room-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
    max_participants: 6,
  },
  {
    scene_id: "room-study",
    display_name: "书房",
    type: "room",
    prompt_weight_overrides: { analysis: 0.2 },
    furniture_slots: 4,
  },
  {
    scene_id: "room-counseling",
    display_name: "心理咨询室",
    type: "room",
    prompt_weight_overrides: { psychology: 0.35 },
    max_participants: 2,
  },
];
