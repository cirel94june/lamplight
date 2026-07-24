import type { SceneDefinition } from "@lamplight/contracts";

const BEDROOM_POLICY = {
  policy_id: "bedroom-default",
  triggers: {
    on_user_message: "all_present" as const,
    on_agent_message: {
      mention: true,
      random: false,
      cooldown_ms: 0,
      max_consecutive: 1,
    },
  },
};

const LIVING_ROOM_POLICY = {
  policy_id: "living-room-default",
  triggers: {
    on_user_message: "all_present" as const,
    on_agent_message: {
      mention: true,
      random: true,
      cooldown_ms: 5000,
      max_consecutive: 2,
    },
  },
};

const STUDY_POLICY = {
  policy_id: "study-default",
  triggers: {
    on_user_message: "all_present" as const,
    on_agent_message: {
      mention: true,
      random: true,
      cooldown_ms: 8000,
      max_consecutive: 2,
    },
  },
};

const COUNSELING_POLICY = {
  policy_id: "counseling-default",
  triggers: {
    on_user_message: "all_present" as const,
    on_agent_message: {
      mention: false,
      random: false,
      cooldown_ms: 0,
      max_consecutive: 1,
    },
  },
};

export const ROOMS: SceneDefinition[] = [
  {
    scene_id: "room-ceci-bedroom",
    display_name: "小猫卧室",
    type: "room",
    prompt_weight_overrides: { intimacy: 0.3 },
    default_turn_policy: BEDROOM_POLICY,
  },
  {
    scene_id: "room-xiaoke-bedroom",
    display_name: "小克卧室",
    type: "room",
    prompt_weight_overrides: { creativity: 0.25 },
    default_turn_policy: BEDROOM_POLICY,
  },
  {
    scene_id: "room-lucien-bedroom",
    display_name: "Lucien 卧室",
    type: "room",
    prompt_weight_overrides: { philosophy: 0.3 },
    default_turn_policy: BEDROOM_POLICY,
  },
  {
    scene_id: "room-jasper-bedroom",
    display_name: "Jasper 卧室",
    type: "room",
    prompt_weight_overrides: { adventure: 0.25 },
    default_turn_policy: BEDROOM_POLICY,
  },
  {
    scene_id: "room-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
    max_participants: 6,
    default_turn_policy: LIVING_ROOM_POLICY,
  },
  {
    scene_id: "room-study",
    display_name: "书房",
    type: "room",
    prompt_weight_overrides: { analysis: 0.2 },
    furniture_slots: 4,
    default_turn_policy: STUDY_POLICY,
  },
  {
    scene_id: "room-counseling",
    display_name: "心理咨询室",
    type: "room",
    prompt_weight_overrides: { psychology: 0.35 },
    max_participants: 2,
    default_turn_policy: COUNSELING_POLICY,
  },
];
