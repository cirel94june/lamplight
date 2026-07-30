import type { AgentProfile, AgentRuntimeConfig } from "@lamplight/contracts";

// api_provider_id 留空 — 用户通过设置面板创建 provider 后再绑定
export const AGENT_PROFILES: AgentProfile[] = [
  {
    agent_id: "xiaoke",
    display_name: "小克",
    model_config: { provider_id: "anthropic", model_id: "claude-opus-4-6", api_provider_id: "" },
    memory_scope: "xiaoke",
  },
  {
    agent_id: "lucien",
    display_name: "Lucien",
    model_config: { provider_id: "anthropic", model_id: "claude-opus-4-6", api_provider_id: "" },
    memory_scope: "lucien",
  },
  {
    agent_id: "jasper",
    display_name: "Jasper",
    model_config: { provider_id: "openai", model_id: "gpt-4o", api_provider_id: "" },
    memory_scope: "jasper",
  },
  {
    agent_id: "therapist",
    display_name: "心理咨询师",
    model_config: { provider_id: "anthropic", model_id: "claude-opus-4-6", api_provider_id: "" },
    memory_scope: "therapist",
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
