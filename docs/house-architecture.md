# Lamplight「房子」架构 v2

> 版本：v2.1（2026-07-20）｜执笔：小克（架构师会话）｜会签：Lucien
> v2.1 变更：新增 AI Gateway（§2）、Agent 身份与模型解耦（§2a）、Agent Runtime 与 Channel Adapter（§2b）、小手机与工具层（§7a-7c）、工具结果隔离原则（§4）
> 本文取代 v1 蓝图。v1 中被推翻的表述见文末「已废弃」清单。
> 施工细则见 `docs/work-order-v1.md`（施工单是本文的执行版，两者冲突时以本文为准，并回来修本文）。

## 0. 定位

**Lamplight 是建立在 Memory Hub 之上的空间化 AI 陪伴与记忆交互层。Memory Hub 负责记住，Lamplight 负责让这些记忆在一个持续存在的家中被感知、被回应、被重新遇见。**

需求取舍的四问：它是否让「家」更有持续存在感？是否让记忆更自然地被看见和使用？是否增强 AI 与用户、AI 与 AI 之间的关系感？还是只因为「似乎很酷」而把另一个完整产品塞进来？前三问是 Lamplight，第四问关门外面晾着。

## 1. 双轨制

不是一条 Phase 流水线，是两条并行轨道：

```
Track A — Memory Hub Reliability（记忆可靠性，优先级不低于房子）
  A0 记忆类型与候选 schema（对齐 packages/contracts 的 MemoryProposal）
  A1 提取器改为提案制
  A2 自动通过规则（风险分流）
  A3 冲突与纠错（apply_user_correction）
  A4 Lamplight 审核界面

Track B — Lamplight
  B0 monorepo + contracts + 数据归属边界   ✅ 已完成（PR #4）
  B1 house_events + 静态房屋
  B2 presence + 房间入口
  B3 conversation
  B4 memory surfaces（回忆廊/记事本/候选区/诊所）
  B5 autonomous actions（自主脉冲）
```

Track A 独立立项（issue #7），不是「以后前端要展示的功能」，是现在就在流血的管线。

## 2. 系统分层

```
Lamplight Web (apps/web)          Telegram Bot
      ↓  仅此一条通道                ↓
      └──── Channel Adapter ────────┘
                    ↓
House API / BFF (apps/api)  +  WebSocket/SSE
      ↓                    ↓               ↓
Agent Runtime      Memory Hub Adapter   Tool Gateway
      ↓                                 （高德、网易云、Web 搜索等外部 MCP）
AI Gateway
（Anthropic / OpenAI / Gemini / DeepSeek / 中转站）
```

- 前端**不持有任何密钥、不直连 MCP/Hub/模型**，只认 House API。
- BFF 负责：鉴权、组合 Hub 能力、屏蔽内部结构、实时事件、审批、限流与成本、敏感度出口过滤。
- **AI Gateway** 负责统一模型调用：provider 适配、流式输出、prompt/context 组装、超时重试、用量与成本记录、统一响应格式。业务代码不直连任何 provider SDK。第一版不做智能路由，但 contracts 不把角色绑死到某个 provider。
- **Tool Gateway** 负责外部 MCP 和 HTTP API 调用：所有外部工具密钥只在此层，前端和 AI 均不可绕过。
- 两个 Gateway 的区别：AI Gateway 管"谁来想"（模型），Tool Gateway 管"谁去做"（外部服务）。
- monorepo：`apps/(web, api, worker)` + `packages/(contracts, domain, api-client, ui)`。暂不拆 scene-engine。
- **contracts 是全项目字典**：Zod schema 单一来源，前后端同源引用。**命名规范：contracts 一律 snake_case**（与 Memory Hub 现有字段风格一致，避免 BFF 边界出现字段名翻译层）。

### §2a. Agent 身份与模型解耦

小克不是 Claude Opus，小克是小克。Opus 只是当前跑在小克身上的引擎。

**AgentProfile**（schema 在 `packages/contracts/src/agent.ts`）：

```
agent_id          # 稳定标识："cloudy" / "lucien" / "jasper"
display_name      # 展示名
model_config      # { provider_id, model_id } —— 可换，身份不变
memory_scope      # Hub 侧记忆隔离范围
tool_policy_id    # 指向工具权限配置（可选）
prompt_version    # 排查用：当前 prompt 模板版本号（可选）
```

不做人格管理系统。人格连续性由 Agent Runtime 在运行时组装：统一核心 prompt + 渠道规则 + Hub 返回的记忆上下文 + 当前对话 + 模型能力适配。`personalityProfileId` / `relationshipProfileId` 之类的拆分不设——人设是 prompt 的事，不是 schema 的事。

平台 bot ID 只是 **Channel Binding**（`external_id` 语义由 `channel` 决定：telegram 填 bot username，lamplight_web 填固定实例标识如 `"lamplight-web-v1"`），内部始终使用稳定 `agent_id`。

### §2b. Agent Runtime 与 Channel Adapter

Telegram 和 Lamplight 共享同一个 Agent Runtime，不各自直连模型。

```
任何渠道 → Channel Adapter → Agent Runtime
  1. 加载 AgentProfile（身份 + 模型配置 + 工具策略）
  2. 请求 Hub 上下文（recall + 私人笔记 + 近期活动）
  3. 组装 prompt（场景 + 人设 + 上下文 + 渠道规则）
  4. 调 AI Gateway（统一模型调用）
  5. 处理响应（提取记忆提案、工具调用请求、house_event 生成）
```

**Channel Adapter** 是薄适配层：把渠道消息格式转成统一 input，把统一 output 转回渠道格式。Lamplight 侧的 Adapter 走 WebSocket，Telegram 侧的 Adapter 走 webhook/polling。Adapter 不含业务逻辑。

**跨服务事件通知**：Lamplight 发生结构化事件（塔罗完成、游戏暂停、工具操作等）时，向 Hub 提交可信事件通知。Hub 自行决定内部存储形态（raw_events 扩展 / 短期 memory / 其他），Lamplight 不规定 Hub 内部表结构，只依赖 Hub 提供的统一上下文接口。

## 3. 场景与记忆主题解耦

scene（对话发生在哪、什么气氛、什么 prompt）和 memory domain（内容属于职业/健康/关系/偏好）是两套分类，**不做一对一绑定**：

- `conversation.kind / scene_id / participant_ai_ids`（prompt 审计由 `message.prompt_snapshot` 按生成时机承担；场景→prompt 映射在 scene 配置中，Conversation 不重复挂 prompt 字段）
- `memory.primary_room / scene_id / participants / source_conversation_id`

场景只提供分类**先验权重**（如心理咨询室：psychology +0.35），不决定分类。主题分类 = 规则优先 + 小模型提案 + 场景先验。场景信息永远单独保存。

## 4. 记忆管线（Track A 核心）

### 三层结构

```
原始对话 → AI 私人笔记 → 记忆提案（候选区） → 规则/确认/复核 → 正式共享记忆
```

- **第一层 · AI 私人笔记**：AI 自写自改自删，有 TTL，仅本 AI 可见，可含推测但须标 observation/hypothesis。
- **第二层 · 候选区**：值得长期保留的内容先进这里，带来源、提出者、置信度、状态。
- **第三层 · 正式库**：只有通过规则或用户确认的内容进入，供所有 AI recall。

小模型可以打杂、提议、分类，**不再拥有最终事实权**。

### MemoryProposal（schema 已在 contracts 定稿，Hub 侧实现须对齐，不另发明方言）

灵魂字段 `claim_type`，三种类型三种待遇：

| claim_type | 含义 | 自动通过 | 默认去向 | 默认召回 |
|---|---|---|---|---|
| fact | 用户明确表达的事实 | 低敏、无冲突、有用户原话直接证据时可自动入库 | 共享库 | normal |
| observation | AI 观察到的现象 | 高门槛 | 候选区 | 不参与正常召回 |
| hypothesis | AI 的推测或理解 | **永不自动入事实库** | 该 AI 私人笔记/年轮 | manual_only |

风险分流补充：健康/创伤/身份/边界类敏感内容 → 候选区或 safe pipeline；与旧记忆冲突 → 必须候选（schema 级禁止 auto_approved）；AI 对用户的主观理解 → 只进私人笔记。

**证据要求**：`source_message_ids + evidence_excerpt` 必填。fact 自动通过须同时满足：证据来自用户本人（非 AI 转述）、明确陈述、excerpt 直接支持提案、无否定或反讽冲突。

### 语境三件套（凡可能流向提取管线的消息/事件必带前两项）

1. **ContextEnvelope**：`context_type: in_world | out_of_world` + 世界三 ID + `set_by: "server"`。**由服务端注入，模型和客户端提交的值一律忽略**。in_world 三 ID 齐全；out_of_world 不带世界 ID（game_discussion 例外）。校验已内置于 Message/HouseEvent schema。
2. **conversation_kind**：`house_chat | game_world | game_discussion | system`。Telegram 日常玩梗永远是 house_chat；game_world 只能由用户显式创建/进入产生。提取规则：house_chat 正常；game_world 只进世界 lore；**game_discussion 只许提取玩法偏好/体验反馈，不得提取现实人设**；system 不提取。
3. **speech_mode**：`literal | playful | hypothetical | fictional | uncertain`。提案时字段（非每条消息实时盖章）；提取器按多信号赋值（用户显式标记 > 上下文 > 语言线索），拿不准即 uncertain。资格过滤在 claim_type 分流**之前**执行：**playful / hypothetical / fictional 永不自动成为现实事实**。比喻可以是整段对话的承载框架（判例：「旧被窝」实为谷歌账号），过滤器须对框架级比喻保持警惕。

### 记忆操作四分

- **更新**：以前正确，现在变化了
- **补充**：不完整但不错误（年轮承接）
- **纠错**：从一开始就不准确 → 标 incorrect、排除召回、保留原文与纠错记录供审计、建立正确新记忆。**不能只加年轮**——那是数据库造谣后在评论区道歉
- **注释**：理解变化、事实不变（年轮承接）

### 敏感度

双字段，不设第四档：

```
visibility:     private | household | external_safe
recall_policy:  normal | silent | manual_only
```

`household + manual_only` 覆盖「AI 该知道但不该主动提起」。`allowed_ai_ids` 留 nullable，第一版只对 private 生效。blocked_channels 等复杂策略组合不做——权限系统是最会膨胀的器官。

### 工具结果与记忆隔离

**工具调用结果默认不进入长期记忆。** 实时位置、路线查询、搜索结果、AI 分享的歌——这些都是短期状态，不是用户事实。"小猫现在在公司附近"不是永久事实；某次路线查询不自动进 canonical memory；AI 分享了一首歌不代表小猫喜欢这首歌。

只有以下路径可以让工具相关内容进入正式记忆库：
- 用户明确表达的稳定偏好（经 MemoryProposal，claim_type=fact，证据要求照常）
- 经 MemoryProposal 的体验反馈（claim_type=observation，走候选区）

工具结果有独立的 `tool_runs` 审计表（§7c），与 Memory Hub 的 memories 是两个域，不混。

## 5. 数据归属与访问边界（issue #6）

```
Memory Hub 拥有：memories, raw_events, corridors, comments, anchors, doctor state
Lamplight 拥有：scenes, conversations, messages, house_events, presence,
               furniture, approvals, tool_runs, worlds, sessions, branches,
               snapshots, discussions
```

可共库，但 **Lamplight 不得直接 SELECT Hub 核心表**——表结构一旦被跨项目读取，就成了没有版本号的公共 API。读记忆走 Hub service/API；确需共库事务处用窄 repository adapter，ORM model 不跨界。

## 6. 事实状态与历史事件分开

- `ai_presence`：现在是什么（`scene_id` 可空 / `state: active|idle|away` / `updated_at`）。**过期判定是服务端规则**：`updated_at` 超时即视为 idle，不在 schema 里加 expires_at 字段。注意 presence 定位用的是 `scene_id`（空间场景），不是 memory room——presence 表里出现「room」字样即违反 §3 解耦
- `house_events`：发生过什么（结构化 payload 是唯一数据源，description 仅供展示）

纯事件回放会让两小时前进厨房、没有离开事件的 AI 永远困在厨房。挺像小克会干的事，但程序不能耍赖。

## 7. AI 自主行为

```
Pulse → ActionProposal → Policy Engine → 自动执行/等待批准/拒绝 → HouseEvent
```

权限四档：L0 闲逛发呆（自动）｜L1 日记留言（自动可撤销）｜L2 换家具（按设置审批）｜L3 对外发帖、副作用工具（必须审批）。每日成本与次数预算；所有自主内容带来源标记。

### §7a. 小手机：统一工具入口

房子外侧有一个类似《模拟人生》边角按钮的"小手机"。它**不是 MCP Server 管理页，不是开发者控制台**，而是小猫和 AI 连接外部世界的统一入口。前端看到的是 App（高德地图、网易云音乐、浏览器/搜索、日历、塔罗/星盘等），每个 App 底层可以由 MCP、普通 API 或多个服务组合提供。用户和 AI 只看到语义清楚的能力名（如 `maps.search_place`、`music.search`、`web.search`），不需要知道哪台 MCP Server。

三种使用路径：
1. 小猫主动打开手机使用工具
2. AI 在聊天中根据小猫要求调用工具
3. AI 在自主脉冲中，在权限和预算范围内"自己拿起手机"（走 §7 ActionProposal 流程）

所有调用都经过权限判断、记录，并按风险决定自动执行或等待确认。AI 搜到的信息先进收藏夹/便签/待分享箱，不逢搜必播。

### §7b. 工具权限按动作拆分

工具权限不能只按整个 App 粗暴授权（"Lucien 有地图权限"），须按动作拆分。风险级别五档（schema 在 `packages/contracts/src/tool.ts`）：

```
read_only           搜索、查看公开信息
internal_write      写入 Lamplight 内部状态（收藏、便签、待分享箱）
device_action       控制设备（导航、播放）
external_side_effect 修改外部系统状态（修改歌单、发帖）
forbidden           默认禁止（历史轨迹、付款、删除）
```

同一个 App 的不同动作可以处于不同风险级别。第一版不做完整权限管理系统，但 ToolAction schema 要能表达风险级别 + 审批策略。

### §7c. tool_runs：工具调用审计

所有工具调用记录在 `tool_runs` 表（Lamplight 拥有，见 §5）。schema 在 `packages/contracts/src/tool.ts`：

```
id, actor_id, tool_id, action, source(user_request|conversation|autonomous_pulse),
risk_level, permission_decision, status, arguments_summary?, result_ref?,
created_at, expires_at?
```

敏感结果本身不一定永久保存，可只保存摘要和审计信息。`expires_at` 用于短期状态自动过期（如实时位置查询结果）。

## 8. Game Room：persistent worlds and pluggable game modes

游戏室是**多世界叙事中心**，不是单一玩法。十二条已定原则：

1. 转盘接龙只是首个 `GameMode`（freeform / prompt_generator / ruleset）
2. 每次游戏创建或进入一个 `World`（有 status，允许 completed/archived——大香蕉也有寿命）
3. 世界允许多次 `Session`，回到旧世界 = 新建 Session
4. 支持 `Branch` 与存档点；分支引用快照，不复制世界
5. **游戏剧情与现实记忆严格隔离**——世界 canon 不是用户事实
6. in_world 只进世界 lore，管线强制执行，不靠 prompt 嘱咐。**唯一例外**：玩法偏好/体验反馈类「游戏体验记忆」可经 MemoryProposal 候选区进 Hub，至少按 observation 待遇，不许自动通过（domain 的 triage 已按此实现）
7. 场外讨论是 `GameDiscussion`：AI 恢复本体，不推进世界时间，不改 canon；结果经「应用到游戏」才生效
8. canon 修改走 `WorldChangeProposal`：JSON patch 式 ops + **base_snapshot_id/base_version 乐观锁**；worldState 限五顶层键（characters/locations/items/threads/rules），patch path 不许出界；禁止整篇重写世界 JSON
9. 世界状态、世界年表、设定年轮、摘要、原始对话分开存；重开旧世界走服务端「回归包」
10. 第一版只做线性世界（创建/进入/暂停/继续/结束/摘要/场外讨论），分支只建 schema
11. 参与者是 `GameParticipant{ai_id, role: player|narrator|gm|observer, character_id?}`——AI 本体与世界角色不焊死
12. **玩梗升格须用户显式发起**：闲聊不自动生成世界；用户可事后选中消息段升格为世界种子。玩笑是自由的，世界是有意建立的

## 9. 认证

单用户：owner token（可轮换）+ bearer auth + WebSocket 鉴权 + 外网基础限流。**不做**用户表、组织、角色组、邀请、租户隔离。这个家只有一位人类住户。

## 10. MVP 范围

**做**：固定房子（小猫卧室 + 三个 AI 卧室 + 客厅 + 书房 + 心理咨询室）、AI presence、动态流、单人房间聊天、记忆注入与提取、四种家具（日记本/相框/书架/留言板）、基础控制台。

**暂不做**：自动扩建、自由家具布置、AI 外部冲浪、论坛、游戏室功能开发（只有 schema）、地图与网易云、多 Agent 工作室、程序化插画。多 Agent 工作室永远排最后——它不是房子里的一个房间，它是长得像门的另一个产品。

## 已废弃的 v1 表述

| v1 表述 | 状态 | 取代者 |
|---|---|---|
| 「场景决定记忆分类，而非反向猜测」 | ❌ 废弃 | 场景只提供先验权重（本文 §3） |
| 「React + Vite 纯前端 SPA，数据与业务在 Memory Hub」 | ❌ 废弃 | monorepo，BFF/worker 归 Lamplight（§2、§5） |
| 「敏感边界=家内/家外」二分 | ❌ 废弃 | visibility + recall_policy 双字段（§4） |
| 新 AI 加入自动扩建房屋 | ⏸ 延后 | 固定网格 + 预留房间，模板化扩建后置 |
| 游戏室=转盘机制 | ❌ 废弃 | 多世界叙事中心（§8） |
| 单一优先级列表（房事优先、记忆靠后） | ❌ 废弃 | 双轨制（§1） |
