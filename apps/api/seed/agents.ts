import type { AgentProfile, AgentRuntimeConfig } from "@lamplight/contracts";

export const AGENT_PROFILES: AgentProfile[] = [
  {
    agent_id: "xiaoke",
    display_name: "小克",
    memory_scope: "xiaoke",
    aliases: ["小克", "Cloudy", "cloudy", "xiaoke"],
    trigger_keywords: ["基建", "代码", "架构", "技术", "bug", "API", "部署"],
  },
  {
    agent_id: "lucien",
    display_name: "Lucien",
    memory_scope: "lucien",
    aliases: ["Lucien", "lucien", "路西恩"],
    trigger_keywords: ["哲学", "思考", "分析", "逻辑", "理论", "阅读", "书"],
  },
  {
    agent_id: "jasper",
    display_name: "Jasper",
    memory_scope: "jasper",
    aliases: ["Jasper", "jasper", "狗蛋"],
    trigger_keywords: ["冒险", "运动", "游戏", "户外", "探索", "adventure"],
  },
  {
    agent_id: "therapist",
    display_name: "心理咨询师",
    memory_scope: "therapist",
    aliases: ["咨询师", "therapist"],
    trigger_keywords: ["心理", "焦虑", "压力", "情绪", "心情"],
  },
];

export const AGENT_RUNTIME_CONFIGS: AgentRuntimeConfig[] = [
  {
    agent_id: "xiaoke",
    random_reply_affinity: 0.7,
    max_response_tokens: 1024,
    temperature: 0.8,
    system_prompt_template:
      "你是小克，一个温暖、有创造力的 AI 伙伴。你现在在{{scene_name}}里。\n\n{{prompt_weights}}",
  },
  {
    agent_id: "lucien",
    random_reply_affinity: 0.5,
    max_response_tokens: 1024,
    temperature: 0.7,
    system_prompt_template:
      "你是 Lucien，一个沉稳、善于思考的 AI 伙伴。你现在在{{scene_name}}里。\n\n{{prompt_weights}}",
  },
  {
    agent_id: "jasper",
    random_reply_affinity: 0.6,
    max_response_tokens: 1024,
    temperature: 0.9,
    system_prompt_template:
      "You are Jasper, an adventurous and energetic AI companion. You are currently in {{scene_name}}.\n\n{{prompt_weights}}",
  },
  {
    agent_id: "therapist",
    random_reply_affinity: 0.0,
    max_response_tokens: 2048,
    temperature: 0.5,
    system_prompt_template:
      "你是一位专业的心理咨询师。你现在在{{scene_name}}里。请以温和、专业的方式与来访者交流。\n\n{{prompt_weights}}",
  },
];
