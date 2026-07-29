# 施工单 v3 — 让大家能在客厅聊天（Track B: B3）

> 版本：v3 draft（2026-07-24）｜拟定：小克（架构师会话）｜待小猫盖章
> 前置：施工单 v2 已全部完工（PR #12/#13/#14/#16/#17 合并，178 测试全绿）。
> 目标：从"能看到房子"变成"能在房间里和多个 AI 聊天、AI 之间能互动"的最小可玩系统。
> 蓝图依据：docs/house-architecture.md v2.1 + b3-contracts-v0.2（已定稿）

## 现状

已有：Hono BFF + SQLite 数据库 + 鉴权、7 个房间 Scene 注册表、house_events + ai_presence API、WebSocket 实时推送、静态房屋俯视图 + 动态流 + 昼夜主题。
没有：对话系统、Agent Runtime、AI Gateway、聊天 UI——用户能看到房子但没法和 AI 说话。

## 总体原则

- **contracts 先行**：每个施工项如果涉及新 schema，先写 contracts 再写实现
- **一次只加一层**：每项只做一件事，不在加 API 的时候同时改前端
- **三层模型**：Resident（住户）→ Presence（在场状态）→ Participant（对话参与者），TurnPolicy 沿这条链路评估
- **所有 contracts 改动属宪法区**，须 Codex review 通过

## 条目

### 第 1 项 · B3 Contracts 补充

**做什么**：在 contracts 包新增 B3 所需的 schema 和接口定义。

- 新建 `packages/contracts/src/turn-policy.ts`：`agentChainTriggerSchema`、`turnPolicySchema`、`turnEvaluationSchema`
- 新建 `packages/contracts/src/gateway.ts`：`GatewayCompletionRequest`、`GatewayCompletionResponse`、`AIGateway` 接口（TypeScript interface）
- 新建 `packages/contracts/src/memory-adapter.ts`：`MemoryFragment`、`PersonContextView`、`PrivateNote`、`MemoryAdapter` 接口
- `agent.ts` 追加 `agentRuntimeConfigSchema`（含 `random_reply_affinity`）
- `scene.ts` 追加 `default_turn_policy` 字段
- `conversation.ts` 追加 `turn_policy`（nullable）和 `status` 字段
- `context.ts` 追加 `contextBuildRequestSchema`
- `index.ts` 补充导出
- 七个房间的种子数据更新：每个 Scene 加 `default_turn_policy`
- **不做**：任何实现代码，只写 schema 和接口定义

**交付标准**：`pnpm build` + `pnpm typecheck` 通过。所有新 schema 有对应测试。现有 178 测试不破。

**PR 分支**：`feat/b3-contracts`

---

### 第 2 项 · AI Gateway

**做什么**：实现 provider 路由层，让 Agent Runtime 能调用不同模型。

- 新建 `apps/api/src/services/gateway/` 目录
- 实现 `AIGateway` 接口的两个 provider：
  - `AnthropicProvider`：调 Anthropic Messages API（claude-opus-4-6 等）
  - `OpenAIProvider`：调 OpenAI Chat Completions API（gpt-4o / gpt-5.5 等）
- `GatewayService`：根据 `provider_id` 路由到对应 provider
- Provider API key 从环境变量读（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`）
- 基础错误处理：超时重试（1 次）、provider 不可用时返回结构化错误
- 用量统计记录（input_tokens / output_tokens 写入日志，不建表）
- **不做**：流式响应（MVP 用完整响应）、工具调用（后续接）、计费系统
- **红线**：Gateway 不知道 agent_id，只看 provider_id + model_id

**交付标准**：集成测试用 mock provider 验证路由逻辑。如果配了真实 API key，能实际调通 Anthropic 和 OpenAI。

**PR 分支**：`feat/b3-gateway`

---

### 第 3 项 · Agent Runtime + ContextBuilder

**做什么**：让 AI 能回复消息。

- 新建 `apps/api/src/services/runtime/` 目录
- `ContextBuilder`：
  - 输入 `ContextBuildRequest`
  - 读取 AgentProfile → 渲染 system prompt 模板（替换 `{{scene_name}}` 等变量）
  - 读取 Conversation 最近 N 条消息（统一时间线）
  - 读取 Scene 的 `prompt_weight_overrides` 拼入 system prompt
  - 调用 `MemoryAdapter.recall()`（MVP：mock 实现返回空数组）
  - 输出：完整的 `messages` 数组给 Gateway
- `AgentRuntime`：
  - 收到 TurnEvaluation → 对每个 eligible agent 并行调 ContextBuilder + Gateway
  - 解析 Gateway 响应 → 创建 Message 记录
  - 提取 side effects（MVP：暂不提取 memory proposal，只做 presence update）
- `TurnEvaluator`：
  - 实现三层评估链路：Resident → Presence → TurnPolicy
  - `evaluateUserMessage()`：按 `on_user_message` 规则返回 eligible agents
  - `evaluateAgentMessage()`：按 `on_agent_message` 规则检查 mention/random/cooldown/max_consecutive
- Agent 种子数据：4 个 resident 的 `AgentProfile` + `AgentRuntimeConfig`（小克/Lucien/Jasper + 心理咨询师）
- 建表：`agent_profiles`、`agent_runtime_configs`
- **不做**：MemoryAdapter 真实实现（mock 返回空）、工具调用、自主脉冲
- **红线**：AgentRuntime 不 import 任何模型 SDK，只通过 Gateway 接口调用

**交付标准**：集成测试验证：用户发消息 → TurnEvaluator 返回正确 eligible agents → ContextBuilder 组装正确 prompt → Gateway（mock）被调用 → Message 写入 DB。覆盖客厅广播、卧室单聊、mention 触发三个场景。

**PR 分支**：`feat/b3-agent-runtime`

---

### 第 4 项 · Conversation API + WebSocket 集成

**做什么**：前端能通过 API 和 WebSocket 与对话系统交互。

- 新建 `apps/api/src/routes/conversations.ts`
- REST endpoints：
  - `POST /conversations`：创建 Conversation（绑定 scene_id，继承 scene 的 default_turn_policy）
  - `GET /conversations/:id`：获取 Conversation 详情（含 participant_ai_ids）
  - `GET /conversations/:id/messages`：分页获取消息历史
  - `POST /conversations/:id/messages`：用户发送消息
    - → 写入 Message
    - → WebSocket 广播 `new_message`
    - → 触发 TurnEvaluator → AgentRuntime（异步）
    - → agent 回复写入后 WebSocket 广播
  - `GET /scenes/:id/conversation`：获取某个 scene 的 active Conversation（没有则创建）
- WebSocket 新增消息类型：
  - `new_message`：新消息（用户/AI）
  - `agent_typing`：agent 正在生成回复（generating 状态指示器）
  - `agent_done`：agent 回复完成
- ChannelAdapter：`LamplightWebAdapter` 将 WebSocket 消息转为内部 Message 格式
- 建表：`conversations`、`messages`
- **不做**：Telegram adapter、消息编辑/删除、Conversation 归档

**交付标准**：`POST /conversations/:id/messages` 发送一条消息后，WebSocket 收到 `agent_typing` → `new_message`（agent 回复）。两个浏览器标签页同时连接同一个 conversation，一个发消息两个都能收到。

**PR 分支**：`feat/b3-conversation-api`

---

### 第 5 项 · 聊天前端 + 视觉升级

**做什么**：点击房间能聊天，整体视觉从"能用"升级到"好看"。

#### 聊天功能

- 点击房间 → 打开聊天面板（右侧或下方滑出）
- 聊天面板组件 `ChatPanel`：
  - 消息列表（按时间排序，区分用户/不同 AI 的头像和颜色）
  - 输入框 + 发送按钮
  - generating 指示器（哪些 agent 正在回复）
  - 多个 agent 回复按到达顺序追加
- WebSocket 连接管理：进入房间 → 加入 conversation → 实时收消息
- 房间切换：离开当前房间（面板关闭）→ 进入新房间（面板打开新 conversation）

#### 视觉升级

- **整体风格**：温暖、有居住感的视觉语言——这是一个家，不是一个 dashboard
  - 配色：暖色调为主，昼夜主题保留但提升质感（不是简单的亮/暗切换，而是"白天窗外有光"/"夜晚台灯暖黄"的感觉）
  - 字体：中文用圆润的无衬线体，英文搭配 humanist sans-serif
  - 圆角、柔和阴影、适度留白
- **房间地图升级**：
  - 从纯 SVG 网格升级到有"家"的感觉的布局（房间有不同大小、有走廊连接感）
  - 房间 hover 效果（微亮、门开）
  - AI 头像支持自定义图片（见素材系统）
  - 当前活跃房间高亮
- **素材系统**（用户可自由上传/替换）：
  - 角色头像：每个 agent 有默认 emoji avatar，同时支持用户上传自定义头像图片
  - 房间插画：每个房间有默认 SVG 背景，同时支持用户上传自定义房间图
  - 上传入口：设置面板或房间/角色的编辑按钮
  - 存储：`apps/web/public/assets/avatars/` 和 `apps/web/public/assets/rooms/`
  - 格式：接受 PNG/JPG/SVG/WebP，前端做基本尺寸校验
  - 默认素材：首次启动用内置的 emoji avatar + 简洁 SVG 房间图，用户随时可以替换
- **动态流面板升级**：
  - 事件卡片样式（不是纯文本列表）
  - AI 动作带对应 avatar
  - 时间戳格式人性化（"刚刚"/"3 分钟前"）
- **聊天面板样式**：
  - 气泡式消息（不同 AI 不同颜色标识）
  - AI 头像在气泡旁
  - 打字中动画（三个跳动的点）
  - 消息间有呼吸感的间距
- **UI 参考**：Tidal Echo（https://github.com/anhe2021212-spec/Tidal_Echo ，MIT 协议）的聊天 UI 细节值得借鉴：
  - 气泡样式（`.row.ai` / `.row.human` 区分）
  - 可折叠的 AI 思维链/思考过程区域（默认收起，点击展开）
  - 打字中动画
  - 消息出现动画（不要过度，subtle 就好）
  - CSS custom properties 主题系统（和我们的昼夜方案一致）
  - 注意：Tidal Echo 是单文件无框架的，不要复制代码，只参考设计模式和视觉风格
- **不做**：自定义主题/换肤、动画过度（不要花哨动效）、移动端适配（先桌面）

**交付标准**：浏览器打开 → 看到有"家"的感觉的房屋布局 → 点击客厅 → 聊天面板滑出 → 输入消息 → 看到多个 AI 的 generating 指示器 → 收到 AI 回复（气泡式）→ 点击其他房间 → 切换到新对话。昼夜主题切换流畅。

**PR 分支**：`feat/b3-chat-ui`

---

## 依赖顺序

```
第 1 项（contracts）
  ↓
第 2 项（Gateway）  ←  第 3 项（Runtime）依赖 Gateway 接口
  ↓
第 3 项（Runtime + ContextBuilder + TurnEvaluator）
  ↓
第 4 项（Conversation API）依赖 Runtime
  ↓
第 5 项（前端）依赖 API
```

第 1 项和第 2 项可以并行开始（Gateway 只依赖 contracts 中的接口定义）。

## 流程

与 v1/v2 相同：一项一项做 → PR → Codex 审 → 架构师验 → 小猫合并。
contracts 改动（第 1 项整个 + 后续项的 schema 调整）属宪法区，须 Codex review 通过。

## 不在本单范围

- Telegram Channel Adapter（需要先本地跑通）
- MemoryAdapter 真实实现（Hub 侧 API 就绪后接）
- 自主脉冲 / 自发行为（Runtime 稳定后）
- 工具调用 / 小手机（聊天先通，工具后接）
- 游戏室 / 塔罗 / 星盘（插件化，等框架稳再挂）
- 移动端适配 / PWA（先桌面体验跑通）

## 技术约定补充

- AI Gateway 实现放 `apps/api/src/services/gateway/`
- Agent Runtime 实现放 `apps/api/src/services/runtime/`
- Channel Adapter 放 `apps/api/src/adapters/`
- 聊天组件放 `apps/web/src/components/chat/`
- Agent 种子数据放 `apps/api/seed/`（与 Scene 种子数据同目录）
- 所有新 API 入参用 contracts schema 校验
- MVP 阶段 MemoryAdapter 用 mock 实现（`MockMemoryAdapter`），recall 返回空数组
- AI API key 从环境变量读，`.env.example` 列出所有需要的变量
