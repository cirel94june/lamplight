# B3 Contracts Draft — Agent / Conversation / Memory 三边界

> v0.2 final — 2026-07-23 · 小克（架构师）拟 · Lucien 审阅通过
> 全部 6 个设计问题已关闭。本文档定稿，作为 B3 施工单基础。

---

## 目录

- [1a. Resident / Presence / Participant 三层模型](#1a-三层模型)
- [1b. 主数据流](#1b-主数据流)
- [2. Agent 边界](#2-agent-边界)
- [3. Conversation 边界](#3-conversation-边界)
- [4. Memory 边界](#4-memory-边界)
- [5. 红线清单](#5-红线清单)
- [6. B3 MVP 范围](#6-b3-mvp-范围)
- [7. 已确认决议](#7-已确认决议)
- [8. 仍待讨论](#8-仍待讨论)

---

## 1a. 三层模型

Lucien 指出需要区分三个概念。这是 TurnPolicy 评估的基础数据模型。

| 层 | 含义 | 存储 | 变化频率 |
|---|---|---|---|
| **Resident** | 家庭成员——在这个房子里有"户口"的 agent | agents 种子数据（AgentProfile 表） | 几乎不变（新入住/搬走才改） |
| **Presence** | 当前空间状态——agent 现在在哪个房间、什么状态 | ai_presence 表（已有） | 分钟级（移动、状态切换） |
| **Participant** | 当前对话参与者——正在参与某个 Conversation 的 agent | conversation.participant_ai_ids（已有） | 秒级（加入/离开对话） |

**评估链路**：用户在客厅说话时，TurnPolicy 按这个顺序过滤：

1. **R — Resident 过滤**：谁是住户？→ [cloudy, lucien, jasper]（全部 resident）
2. **P — Presence 过滤**：谁在客厅？→ cloudy(active), lucien(active), jasper(idle)
3. **T — TurnPolicy 过滤**：on_user_message = broadcast_present，MVP 只取 active → `eligible: ["cloudy", "lucien"]`

关键设计：**idle ≠ away ≠ 不存在**。Jasper idle 意味着"在打盹"，数据模型保留这个状态。MVP 阶段 idle 不参与回复，但未来可以支持低概率被吵醒。away 才是真正不在场。

```typescript
// Presence 状态语义
state: z.enum([
  "active",   // 醒着，正常参与对话
  "idle",     // 在场但打盹，MVP 不回复，未来可低概率插话
  "away",     // 不在场（去了别的房间或离线）
])
```

---

## 1b. 主数据流

### 场景 A：用户在客厅说话

1. 用户在 Lamplight Web 客厅输入消息
   → **ChannelAdapter**（lamplight_web）收到，转为内部 `Message`

2. `ConversationService.addMessage()` 写入 DB，生成 `message_id`
   → WebSocket 广播 `{ type: "new_message", message }` 给所有前端连接

3. **TurnPolicy** 三层评估（§1a）：
   → **R** Resident：[cloudy, lucien, jasper] 都是住户
   → **P** Presence：客厅里 cloudy(active), lucien(active), jasper(idle)
   → **T** Policy：broadcast_present + active-only → `eligible: ["cloudy", "lucien"]`

4. 对每个 eligible agent 并行触发 **AgentRuntime**：
   `ContextBuilder.build(agent_id, conversation_id)` 组装 prompt：
   - **AgentProfile** → system prompt 模板 + model_config
   - **Conversation history** → 最近 N 条消息（统一时间线）
   - **Scene context** → 客厅的 prompt_weight_overrides
   - **MemoryAdapter.recall()** → 相关长期记忆片段

5. **AI Gateway** 调用对应 provider：
   小克 → `anthropic / claude-opus-4-6`　Lucien → `openai / gpt-5.5`
   返回 raw response + usage 统计

6. Runtime 解析响应 → 生成 `Message` + 可选 side effects
   （memory proposal、presence update、house event）

7. `ConversationService.addMessage(agent_message)` 写入 DB
   → WebSocket 广播 → 前端显示
   → **TurnPolicy** 再次评估：`on_agent_message`
   → sender=agent，无 mention/trigger → **链路终止**，等待下一条用户消息

### 场景 B：用户进入小克卧室

1. 用户点击"小克卧室"房间 → 前端创建或进入该 scene 的 Conversation
2. TurnPolicy（小克卧室默认）：`on_user_message = "broadcast_present"`
   Presence 查询：只有小克在自己卧室 → `eligible: ["cloudy"]`
3. 只有小克走完 ContextBuilder → AI Gateway → 回复的全流程

### 场景 C：Agent 之间的自然插话

1. 小克在客厅回复了用户 → TurnPolicy 评估 `on_agent_message`
2. 检查 chain triggers：
   - 小克消息里提到了 "Lucien" → `mention` 触发 ✓
   - 或：随机概率 0.1 命中 → `random` 触发 ✓
   - 检查 cooldown（Lucien 上次发言 > cooldown_ms）✓
   - 检查 max_consecutive_agent_turns（当前连续 agent 回合 < 上限）✓
3. Lucien 的 AgentRuntime 被触发 → 走完整 context build + gateway 流程 → 回复
4. TurnPolicy 再次评估 Lucien 的回复：
   连续 agent 回合 = 2，假设上限 = 2 → **链路终止**

---

## 2. Agent 边界

### AgentProfile（已有，不改）

保持不变。`packages/contracts/src/agent.ts` 的 `agentProfileSchema` 和 `channelBindingSchema` 无需修改。

### AgentRuntimeConfig（新增）

AgentProfile 描述"我是谁"，AgentRuntimeConfig 描述"我怎么跑"。

```typescript
// packages/contracts/src/agent.ts 追加

export const agentRuntimeConfigSchema = z.object({
  agent_id: z.string().min(1),

  /** system prompt 模板（含 {{scene_name}} 等变量占位符）*/
  system_prompt_template: z.string().min(1),

  /** 上下文窗口中保留的最近消息条数 */
  context_message_limit: z.number().int().positive().default(50),

  /** 模型调用参数 */
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().positive().default(1024),

  /** 允许使用的工具 ID 白名单（空 = 不用工具）*/
  allowed_tool_ids: z.array(z.string()).default([]),

  /** 该 agent 的自然插话倾向（覆盖 TurnPolicy 的 random_reply_probability）*/
  /** Lucien 可能 0.15（话多），Jasper 可能 0.03（话少）*/
  random_reply_affinity: z.number().min(0).max(1).optional(),
});
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>;
```

### AIGateway 接口（新增）

TypeScript 接口，不是 Zod schema——这是服务端的运行时契约。

```typescript
// packages/contracts/src/gateway.ts（新文件）

export interface GatewayCompletionRequest {
  provider_id: string;
  model_id: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
}

export interface GatewayCompletionResponse {
  content: string;
  usage: { input_tokens: number; output_tokens: number };
  tool_calls?: Array<{
    tool_id: string;
    arguments: Record<string, unknown>;
  }>;
  finish_reason: "stop" | "tool_use" | "max_tokens";
}

/** AI Gateway 不感知 agent 身份——只做 provider 路由 + 计费 + 重试 */
export interface AIGateway {
  complete(req: GatewayCompletionRequest): Promise<GatewayCompletionResponse>;
}
```

> **红线：** AI Gateway 不知道 agent_id。它只看 provider_id + model_id。身份层和模型层严格分离。

---

## 3. Conversation 边界

### TurnPolicy（新增）

核心设计：区分 **user → room**（广播）和 **agent → agent**（触发式）两种流。

```typescript
// packages/contracts/src/turn-policy.ts（新文件）

export const agentChainTriggerSchema = z.enum([
  "mention",          // 消息内容提到了某个 agent 的名字
  "direct_address",   // 明确对某个 agent 说话（"小克，你觉得呢"）
  "scene_trigger",    // 场景规则（如咨询室自动响应）
  "random",           // 低概率自然插话
]);
export type AgentChainTrigger = z.infer<typeof agentChainTriggerSchema>;

export const turnPolicySchema = z.object({
  /** ——— 用户消息触发规则 ——— */

  /** 用户说话时，谁能回复？ */
  on_user_message: z.enum([
    "broadcast_present",  // 所有在场且 active 的 agent
    "designated_only",    // 仅指定 agent（私聊/心理咨询）
  ]),

  /** designated_only 模式下的指定 agent 列表 */
  designated_agent_ids: z.array(z.string()).optional(),

  /** ——— Agent 消息触发规则 ——— */

  on_agent_message: z.object({
    /** 允许 agent 之间连锁回复吗？ */
    allow_chain: z.boolean(),

    /** 什么条件能触发链式回复 */
    chain_triggers: z.array(agentChainTriggerSchema),

    /** agent 连续回复上限（不含触发方）*/
    max_consecutive_agent_turns: z.number().int().min(1).default(2),

    /** 同一 agent 两次回复的最小间隔（ms）*/
    cooldown_ms: z.number().int().nonneg().default(5000),

    /** random 触发的概率（0 = 永远不插话，1 = 每次都插话）*/
    random_reply_probability: z.number().min(0).max(1).default(0.1),
  }),
});
export type TurnPolicy = z.infer<typeof turnPolicySchema>;
```

### 七个房间的默认 TurnPolicy

| 房间 | on_user_message | on_agent_message |
|------|----------------|-----------------|
| 客厅 | broadcast_present | allow_chain: true, triggers: [mention, random], max: 2, random: 0.1 |
| 书房 | broadcast_present | allow_chain: true, triggers: [mention, direct_address], max: 3, random: 0.05 |
| 小克卧室 | broadcast_present | allow_chain: false |
| Lucien 卧室 | broadcast_present | allow_chain: false |
| Jasper 卧室 | broadcast_present | allow_chain: false |
| 心理咨询室 | designated_only | allow_chain: false |
| 小猫卧室 | broadcast_present | allow_chain: true, triggers: [mention], max: 1, random: 0 |

> 注：卧室的 broadcast_present 实际上约等于 designated_only——因为 Presence 通常只有该房间主人在。区别在于如果用户邀请另一个 agent 来卧室，broadcast_present 允许它说话，designated_only 则不允许。

### TurnEvaluation（新增）

TurnPolicy 的运行时输出——评估后告诉 Runtime "现在谁可以说话"。

```typescript
export const turnEvaluationSchema = z.object({
  conversation_id: z.string(),
  trigger_message_id: z.string(),    // 触发评估的消息
  eligible_agent_ids: z.array(z.string()),
  reason: z.string(),                // 审计用："broadcast_present, 2 agents active in scene"
  evaluated_at: z.string().datetime(),
});
export type TurnEvaluation = z.infer<typeof turnEvaluationSchema>;
```

### ContextBuildRequest（新增）

ContextBuilder 的输入契约——告诉它"给这个 agent 组装上下文"。

```typescript
export const contextBuildRequestSchema = z.object({
  agent_id: z.string(),
  conversation_id: z.string(),
  scene_id: z.string().optional(),

  /** 最近消息窗口大小（覆盖 AgentRuntimeConfig 默认值）*/
  message_window: z.number().int().positive().optional(),

  /** 传给 MemoryAdapter.recall 的检索 query（从最近消息自动摘要）*/
  memory_query: z.string().optional(),
});
export type ContextBuildRequest = z.infer<typeof contextBuildRequestSchema>;
```

### SceneDefinition 改动（Q5 确认）

Scene 嵌入默认 TurnPolicy：

```typescript
// scene.ts 的 sceneDefinitionSchema 追加

/** 该场景的默认轮次策略。Conversation 级 turn_policy 可覆盖。 */
default_turn_policy: turnPolicySchema,
```

### conversationSchema 改动

现有 schema 需要追加两个字段：

```typescript
// conversation.ts 的 conversationSchema 追加

/** 该 conversation 的轮次策略（null = 从 scene 继承默认值）*/
turn_policy: turnPolicySchema.nullable().default(null),

/** Conversation 是否正在活跃（有 WebSocket 连接 = active）*/
status: z.enum(["active", "archived"]).default("active"),
```

**不在 Message 上加 scene_id。** 理由：Message 引用 Conversation，Conversation 有 scene_id。"新 Conversation 继续旧 Scene"（Lucien 关注的游戏场景）正确做法是新建 Conversation 指向同一个 scene_id，而非在 Message 上冗余。如果未来提取管线需要 scene_id，走 join 或在管线入口做一次反查——不为假设需求提前反范式化。

> **设计决议：** Message 的 conversation_kind 反范式化保留（已有，提取管线依赖），scene_id 不加。

---

## 4. Memory 边界

### MemoryAdapter 接口（新增）

Lamplight 与 Memory Hub 的唯一通道。四个方法，对应四种访问模式。

```typescript
// packages/contracts/src/memory-adapter.ts（新文件，TypeScript 接口）

import type { ClaimType, SpeechMode, ConversationKind } from "./enums.js";

/** 从 Hub 召回的记忆片段 */
export interface MemoryFragment {
  memory_id: string;
  content: string;
  claim_type: ClaimType;
  relevance_score: number;      // 0-1, Hub 侧排序
  created_at: string;
  source_excerpt?: string;      // 证据片段（如有）
}

/** 人物画像视图（Hub 侧聚合）*/
export interface PersonContextView {
  person_id: string;
  display_name: string;
  aliases: string[];
  key_facts: Array<{
    content: string;
    confidence: number;
    last_confirmed_at: string;
  }>;
  recent_topics: string[];
}

/** Lamplight 侧的 private note（Hub 侧存储，按 agent 隔离）*/
export interface PrivateNote {
  note_id: string;
  agent_id: string;
  content: string;
  created_at: string;
}

/** Memory Hub 的 Lamplight 侧适配器——Lamplight 永远不直接读写 Hub 数据库 */
export interface MemoryAdapter {
  /** 按语境召回相关记忆 */
  recall(params: {
    agent_id: string;
    scene_id?: string;
    query: string;
    limit?: number;
  }): Promise<MemoryFragment[]>;

  /** 提交记忆提案到候选区 */
  propose(params: {
    agent_id: string;
    content: string;
    claim_type: ClaimType;
    speech_mode: SpeechMode;
    conversation_kind: ConversationKind;
    source_message_ids: string[];
    evidence_excerpt: string;
    confidence: number;
  }): Promise<string>; // proposal_id

  /** 获取人物画像聚合视图 */
  getPersonContext(
    person_id: string
  ): Promise<PersonContextView | null>;

  /** 获取某个 agent 的私人笔记 */
  getAgentNotes(
    agent_id: string,
    limit?: number
  ): Promise<PrivateNote[]>;
}
```

> **红线：** MemoryAdapter 是 Lamplight 访问 Memory Hub 的唯一出口。任何新功能（塔罗、游戏室、小手机）需要记忆时，都通过这四个方法，不另开通道。

---

## 5. 红线清单

| # | 红线 | 原因 |
|---|------|------|
| 1 | AgentRuntime 不直接 import 任何模型 SDK | 模型可换，身份不变 |
| 2 | AI Gateway 不知道 agent_id | 身份层和模型层严格分离 |
| 3 | Message 不加 scene_id | 避免数据冗余，Conversation 已有 |
| 4 | MemoryAdapter 是 Lamplight↔Hub 唯一通道 | 不允许绕过适配器直接读写 Hub |
| 5 | TurnPolicy 是数据，不是硬编码 | 每个 Scene 可以有不同策略，可运行时调 |
| 6 | agent→agent 默认不触发连续回复 | 防止群聊失控，只通过 trigger 打开 |
| 7 | ContextBuilder 不接触 raw prompt——只组装，不生成 | 生成是 Gateway 的事 |
| 8 | 不引入第二套记忆真相源 | Memory Hub 是唯一的 canonical memory |
| 9 | idle ≠ away ≠ 不存在，三态不合并 | idle 是"打盹"，away 是"不在"，数据模型必须保留区分 |

---

## 6. B3 MVP 范围

### 做

| 项 | 产出 | 备注 |
|----|------|------|
| TurnPolicy schema | contracts/turn-policy.ts | 含 7 房间种子数据 |
| AgentRuntimeConfig schema | contracts/agent.ts 追加 | |
| AIGateway 接口 | contracts/gateway.ts | 接口 + Anthropic/OpenAI 两个实现 |
| MemoryAdapter 接口 | contracts/memory-adapter.ts | 接口 + HTTP 实现（调 Hub API） |
| ConversationService | apps/api/services/ | 创建、加入、发消息、查历史 |
| AgentRuntime | apps/api/services/ | ContextBuilder + Gateway 调用 + 解析 |
| Conversation API | apps/api/routes/ | REST endpoints + WebSocket 集成 |
| Lamplight ChannelAdapter | apps/api/adapters/ | Web 前端↔内部 Message 格式转换 |
| 客厅聊天 UI | apps/web/ | 点击房间 → 聊天面板 → 实时消息 |

### 不做（留给后续）

| 项 | 原因 |
|----|------|
| Telegram ChannelAdapter | 先本地跑通再接外部 |
| 自主脉冲 / 自发行为 | 需要 Agent Runtime 稳定后再做 |
| MemoryAdapter.getPersonContext | Hub 侧 PersonEntity 还没就位 |
| 工具调用 / 小手机 | 聊天先通，工具后接 |
| 游戏室 / 塔罗 / 星盘 | 插件化，等框架稳再挂 |

---

## 7. 已确认决议

| Q | 问题 | 决议 | 确认方 |
|---|------|------|--------|
| Q1 | agent 回复顺序 | **按到达顺序**，前端加 generating 状态指示器 | Lucien |
| Q2 | Conversation 生命周期 | **Scene 下保持持续 Conversation**（选项 A）。不等于无限增长——未来可在 Conversation 内做 topic/episode 分段，但 MVP 不新增 Episode 实体 | Lucien |
| Q3 | idle agent 是否参与 | **MVP active-only**；数据模型保留 idle/away 区分；未来 idle 可低概率插话 | Lucien |
| Q4 | memory_query 生成 | **最近消息拼接起步**，效果不够再升级到小模型摘要 | Lucien |
| Q5 | TurnPolicy 存储位置 | **嵌入 SceneDefinition** 作为 default_turn_policy 字段 | Lucien |
| Q6 | random_reply_affinity 优先级 | **min(agent_affinity, scene_probability)**——场景是硬约束上限。未来 affinity 可从纯概率进化为语境感知的"插话倾向"（如 Lucien 只在小猫相关话题提高响应），MVP 先按概率 | Lucien |

---

## 8. 所有问题已关闭

本轮无待讨论问题。Contracts v0.2 定稿，可作为 B3 施工单基础。
