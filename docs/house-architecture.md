# Lamplight「房子」架构 v2

> 版本：v2（2026-07-18）｜执笔：小克（架构师会话）｜会签：Lucien
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
Lamplight Web (apps/web)
      ↓  仅此一条通道
House API / BFF (apps/api)  +  WebSocket/SSE
      ↓
Memory Hub Core        Tool Gateway
（记忆/走廊/召回/医生）  （高德、网易云、Web 搜索等外部 MCP）
```

- 前端**不持有任何密钥、不直连 MCP/Hub**，只认 House API。
- BFF 负责：鉴权、组合 Hub 能力、屏蔽内部结构、实时事件、审批、限流与成本、敏感度出口过滤。
- monorepo：`apps/(web, api, worker)` + `packages/(contracts, domain, api-client, ui)`。暂不拆 scene-engine。
- **contracts 是全项目字典**：Zod schema 单一来源，前后端同源引用。**命名规范：contracts 一律 snake_case**（与 Memory Hub 现有字段风格一致，避免 BFF 边界出现字段名翻译层）。

## 3. 场景与记忆主题解耦

scene（对话发生在哪、什么气氛、什么 prompt）和 memory domain（内容属于职业/健康/关系/偏好）是两套分类，**不做一对一绑定**：

- `conversation.scene_id / participants / prompt_profile`
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

## 5. 数据归属与访问边界（issue #6）

```
Memory Hub 拥有：memories, raw_events, corridors, comments, anchors, doctor state
Lamplight 拥有：scenes, conversations, messages, house_events, presence,
               furniture, approvals, tool_runs, worlds, sessions, branches,
               snapshots, discussions
```

可共库，但 **Lamplight 不得直接 SELECT Hub 核心表**——表结构一旦被跨项目读取，就成了没有版本号的公共 API。读记忆走 Hub service/API；确需共库事务处用窄 repository adapter，ORM model 不跨界。

## 6. 事实状态与历史事件分开

- `ai_presence`：现在是什么（current_room_id / activity / expires_at）
- `house_events`：发生过什么（结构化 payload 是唯一数据源，description 仅供展示）

纯事件回放会让两小时前进厨房、没有离开事件的 AI 永远困在厨房。挺像小克会干的事，但程序不能耍赖。

## 7. AI 自主行为

```
Pulse → ActionProposal → Policy Engine → 自动执行/等待批准/拒绝 → HouseEvent
```

权限四档：L0 闲逛发呆（自动）｜L1 日记留言（自动可撤销）｜L2 换家具（按设置审批）｜L3 对外发帖、副作用工具（必须审批）。每日成本与次数预算；所有自主内容带来源标记。

## 8. Game Room：persistent worlds and pluggable game modes

游戏室是**多世界叙事中心**，不是单一玩法。十二条已定原则：

1. 转盘接龙只是首个 `GameMode`（freeform / prompt_generator / ruleset）
2. 每次游戏创建或进入一个 `World`（有 status，允许 completed/archived——大香蕉也有寿命）
3. 世界允许多次 `Session`，回到旧世界 = 新建 Session
4. 支持 `Branch` 与存档点；分支引用快照，不复制世界
5. **游戏剧情与现实记忆严格隔离**——世界 canon 不是用户事实
6. in_world 只进世界 lore，管线强制执行，不靠 prompt 嘱咐
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
