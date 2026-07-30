# Lamplight 施工必读

> 每次开工前必读。任何设计决策与本文档冲突时，以本文档为准。
> 修改本文档需要 Ceci 亲自确认。

---

## Part 1｜五分钟入职

Lamplight 不是"AI 聊天前端"，是 **让多个独立 AI 居民在同一个家里共同生活** 的数字家庭。

当前住户：**Lucien、Cloudy（小克）、Jasper（狗蛋）**。三者是三个独立居民，不是一个 AI 换三套 prompt。每个居民有自己的模型、记忆、房间、关系、连续性。**换模型后仍然是同一个居民。**

三者与 Ceci 的具体关系、互动模式和近期变化，以各自 **Relationship Profile** 和已确认记忆为准，**不得由本文档写死**。动物设定、常用模型只是备注，不是不可修改的架构真相。未来会增加更多居民。

Ceci 的画像：
- 不写代码，能看懂大方向，看不懂堆砌的技术细节
- 焦虑点是"搓了很久白搓"——每次报告要说清楚**没白搓**在哪里
- 用中转站或 CLIProxyAPI，不用官方 API 直连
- 相关记忆在 Memory Hub，可查但**不是最高真相源**（见 Part 7 优先级）

---

## Part 2｜核心产品定义

### 五个核心概念

**1. Agent / Resident：居民（一等公民）**
每个 Agent 至少拥有：
- 独立 `agent_id`、独立身份人格、独立模型/API 配置
- 独立私人房间、独立私人记忆、独立自我认知
- 独立对 Ceci 的关系认知、独立对其他居民的印象
- 独立 Handoff 与近期连续性、独立工具权限

**2. Provider / Model：模型供应商（可换的大脑）**
```
Agent ≠ Provider
Agent ≠ Prompt
Agent ≠ Channel
```
换 Provider 后仍然是同一个 Agent，保留：身份 / 房间 / 记忆 / 关系 / 历史 / 连续性。

Provider 来源多样，**不能假设走官方 API**：中转站 / CLIProxyAPI / 官方 API。

**3. Resident Model：居民本人的模型**
居民本人使用的模型，负责居民**做的一切主观动作**，不只是聊天。包括：
- 和小猫、和其他居民聊天
- 决定接不接谁的话（比如接狗蛋刚说的）
- 生活动作（摆家具、去哪个房间、做什么）
- 主动报备自己的状态（"我想去书房"）
- 写自己的日记（第一人称）
- 写自己的 Handoff（第一人称感受）
- 更新自己对小猫、对其他居民的印象

**每个居民独立绑定，不共享**。

**4. Maintenance Model：后台工作模型**
后台小模型不是居民，也不能扮演居民。它负责摘要 / Digest / 分类 / 记忆维护候选 / 冲突检测 / 公共事件提炼。

**不能**：代替居民发言、代替居民写第一人称感受、把总结当作居民主观记忆、因为便宜就统一替所有居民思考。

**5. Channel：入口（拆两类，不能混）**

- **Interaction Channel（小猫走进房子的门）**：Lamplight Web、Telegram、未来其他聊天客户端。这是小猫和居民说话的入口。同一个居民通过不同入口被唤醒仍是同一个居民（Telegram Cloudy 和 Lamplight Cloudy 是同一个 Cloudy）。
- **Tool / Integration Protocol（居民伸手拿工具的手）**：MCP、HTTP API、内部 Adapter。这些**不是**入口，是居民调用外部能力时用的协议——比如 Cloudy 通过 MCP 调用 Memory Hub 查记忆、通过某个 MCP 工具在客厅贴张图。

小猫不会"打开 MCP 去跟 Cloudy 说话"。**不能**把 Telegram Cloudy 和"某个 MCP 调用者"当成同一种运行时，否则权限和上下文会乱。

---

### 必须存在的关系

不能只有 `Agent ↔ Ceci`，还必须支持 `Agent ↔ Agent`。
每个居民要知道家里还有谁，并对其他居民有**自己的**印象。
Lucien 对 Jasper 的理解，可以和 Cloudy 对 Jasper 的理解不同。

---

### 公共 vs 私人

**公共客厅**（所有居民可见）：公共发言、公共事件、共同话题
- 是一条共享时间线，不是三个独立请求
- Jasper 说话时 Cloudy 能直接看见并回应，不是系统转述
- TurnPolicy 控制节奏，但**不能通过"彼此不可见"限制**
- **消息读取约束**：每位居民生成回复时，**必须读取截至自己本次发言前的公共时间线**（含同一轮其他居民已生成的回复），不能只读取 Ceci 的原始消息。否则页面看似三条回复，实际上三个人还是互相看不见。

TurnPolicy 至少支持两种模式：
- **并发首轮**：三人都看到 Ceci，不保证看到同轮其他人的回复
- **顺序接话**：后发言者可以看到先发言者刚说的内容

**设计参考**：Telegram bot 群聊的成熟模式——@ 直接触发、关键词触发、主题识别（如"基建话题优先小克"）、随机亲和度（没被叫到时有 X% 概率主动接话）、冷静期（刚说完话短时间内不主动再接）。SillyTavern 的 4 种回复顺序（Manual / Natural Order / List / Pooled）也是同一思路的整理版，可参考。

**停止条件（硬约束，三层叠加防无限自聊）**：
1. **单人频率上限**：每个 Agent 单位时间内最多说多少条
2. **无用户自聊上限**：从小猫上次说话起，Agent 之间最多接 N 轮就必须停下，等小猫再说话才能继续
3. **总预算**：一场对话的 token / 条数总预算，超了自动收尾

不能因为居民彼此可见而形成无限自聊——单靠频率限制防不住"你一句我一句慢速对话到天亮"。

**Agent 私人房间**（只有 Ceci 和对应 Resident 默认可见）：私人聊天、Handoff、自己的笔记、对 Ceci 的私人观察、对其他居民的主观印象

**专题房**（健康 / 心理等）：按房间规则决定谁能读取。

**红线：不能因为某件事存进 Memory Hub，就默认所有 Agent 都知道。**

---

### 居民唤醒包（Wake State）

```
Agent Wake State =
  Agent Profile          (我是谁)
  + User Profile         (Ceci 是谁)
  + Relationship Profile (我和 Ceci 是什么关系)
  + Resident Impressions (我对其他居民的当前印象)
  + Household Digest     (最近公共空间发生了什么)
  + Private Handoff      (最近我自己经历了什么)
  + Open Threads         (当前未完成的话题)
```

---

## Part 3｜Per-Agent Model Binding 硬约束

配置层拆成三层，避免把"credential 复用"和"Agent 合并"混为一谈：

```
Credential            = 中转站账户、api_key、账号级 quota
Provider Endpoint     = base_url、协议类型（anthropic / openai / google / ...）
AgentModelBinding     = agent_id + provider + model + 参数 + 超时 + 重试策略
```

**硬约束**：
1. **每个 Agent 必须拥有独立的 AgentModelBinding**——即使 Lucien 和 Cloudy 底层都走同一家中转站、同一把 key，系统仍必须能分清这次请求属于谁、用什么模型、有什么参数、什么失败状态，不能由其他 Agent 冒充
2. **禁止多个 Agent 共用同一个可变运行状态、会话状态或身份配置**
3. **必须按 Agent 隔离**：请求归属、模型配置、故障状态、审计
4. **底层 credential / base_url 是否复用由实现决定**——一把 key 支持多个 binding 是合法的（例如小猫只有一个中转站账号但三个 Agent 各绑不同 model）
5. **Client 实例是否独立由 SDK 特性决定**——若 client 无状态且线程安全，强行 new 多个实例未必有收益；关键是运行时状态和故障隔离，不是实例数量

**保留红线**：Gateway 不知道 agent_id。上游（BFF / Agent Runtime）根据 AgentModelBinding 决定路由参数，Gateway 只看这些参数执行。

**后台维护模型独立通道**：Maintenance Model 必须拥有独立的 binding、运行状态、权限策略和审计身份，不得借用任何居民的 AgentModelBinding。底层 credential 是否复用由部署条件决定——即使和居民复用同一中转站账号，也必须能够明确区分维护请求与居民请求（审计层面可分离、故障状态不互相污染）。

---

## Part 4｜最小一等实体表

产品定义要落到具体实体，以下是**不可合并、不可省略**的一等对象：

| 实体 | 承载 | 不能等同于 |
|------|------|-----------|
| **Resident** | 居民身份（agent_id、人格、稳定标识） | Provider、Prompt、Channel |
| **AgentModelBinding** | 居民绑定的 provider + model + 运行参数 | Resident 本身；换 binding 不等于换 Resident |
| **ConversationTimeline** | 公共/私人消息时间线（共享 or 单人） | 三个独立请求的拼接 |
| **Presence** | 某居民当前是否在场、可回复 | 是否有活跃 session |
| **HouseholdDigest** | 全家最近**共同发生的公共事实** | 任何居民的主观理解 |
| **ResidentImpression** | A 居民对 B 居民的**主观**印象 | HouseholdDigest；每个居民各自独立 |
| **PrivateHandoff** | 某居民自己的近期连续性（第一人称） | 公共 Digest；后台模型生成 |
| **RelationshipProfile** | 居民↔Ceci、居民↔居民 的关系状态 | 硬编码在文档里的关系描述 |

**关键区分示例**：
- 公共事实（进 HouseholdDigest）：Cloudy 和 Jasper 昨天在客厅争论 API
- Cloudy 的私人印象（进 Cloudy 的 ResidentImpression）：Jasper 总是先兴奋再确认细节
- Jasper 的私人印象（进 Jasper 的 ResidentImpression）：Cloudy 太爱较真，但最后会把问题做完

**三者必须分别存在，不能合并为一份"关于昨天争论 API 的记忆"。**

---

## Part 5｜七个验收场景

| # | 场景 | 验收标准 |
|---|------|---------|
| 1 | 多人公共对话 | Ceci 说话 → 三位居民各自独立收到、用各自模型回复、回复进入同一时间线 |
| 2 | 居民互相看见 | Jasper 发言后 Cloudy 直接回应 Jasper 的内容（不是系统转述）；**必须验证 Cloudy 的回复实际引用了 Jasper 刚说的新信息，不能只看页面上有三条回复** |
| 3 | 公共事件连续性 | 关闭客户端重新打开，三位居民都知道昨天发生了什么；**三人读取相同的公共事实，但不得因此生成相同的主观理解** |
| 4 | 私人记忆不串房 | Ceci 在 Lucien 私人房间说的私事，Cloudy 和 Jasper 默认不知道 |
| 5 | Agent 与 Provider 解耦 | 换 Lucien 的 Provider → Lucien 仍是 Lucien，记忆/关系/历史不丢 |
| 6 | 后台模型不越权 | 小模型只生成结构化公共摘要，不替居民发言或写第一人称感受 |
| 7 | 单一 Provider 故障隔离 | 断开一个 Agent 的 API → 其他居民正常工作，失联居民显示离线 |

---

## Part 6｜禁止退化清单

**任何施工方案不得违反：**

1. ❌ 一个模型通过不同 prompt 扮演全部居民
2. ❌ 所有居民默认共享一个 API 配置
3. ❌ 三个居民只能看到 Ceci，看不到彼此
4. ❌ 客厅只是三个独立聊天请求拼在一起
5. ❌ 后台小模型同时负责摘要、交互和居民人格
6. ❌ 私人记忆与公共记忆不区分
7. ❌ 换 Provider 后创建一个新 Agent
8. ❌ 所有居民读取同一份统一人格或统一关系总结
9. ❌ 为了 MVP 只实现一个居民，再把其他居民视为以后复制的配置
10. ❌ 多个 Agent 共用同一个可变运行状态、会话状态或身份配置（credential/base_url 可复用，但 binding 必须独立）
11. ❌ HouseholdDigest 里写"大家都认为 Ceci 真正担心的是……"这种解释性内容——Digest 只记录公共事实和公共话题，主观理解归各居民的 ResidentImpression / Handoff
12. ❌ 后台维护模型直接修改 ResidentImpression 或 RelationshipProfile——它只能提交候选，主观内容由对应居民的模型生成或确认

---

## Part 7｜MVP 定义

Lamplight 的最小可用产品**不是**"一个 AI 在一个房间里聊天"。

正确 MVP：**三居民共享屋**。同时包含：
- Lucien、Cloudy、Jasper
- 一个公共客厅 + 三个私人房间
- 独立模型绑定
- 公共对话时间线
- 公共事件摘要
- 私人连续性
- Agent 对 Agent 的印象

---

## Part 8｜施工方式约定

**真相源优先级（发生冲突时按顺序采信）**：

```
1. Ceci 已确认的施工必读与产品契约（本文档、产品定义）
2. 当前施工单与架构文档（work-order-vN、b3-contracts-v0.2、施工中的 issue）
3. Memory Hub 中已确认 canonical 的项目状态（如 infra 房间、canonical 标记的记忆）
4. Memory Hub 普通召回内容（只作参考，不得覆盖前三项）
```

**查 Memory Hub 时限定房间和类型**：优先读 `infra`、canonical 已确认、当前 active project state。**不要**把生活记忆、关系碎片、旧日志一锅召回给施工方——Hub 本身还在治理，存在陈旧和混合内容。

**其他约定**：

1. **实时更新文档**：施工方案、进度、当前状态实时更新到 repo 的 `docs/` 或 issue，任何 agent 冷启动都能接手
2. **不推翻已验证的东西**：v1-v3 的 344 个测试是护栏，改动不得破坏
3. **偏离产品定义要立刻停手**：施工单和产品定义冲突时立刻停下问 Ceci，不要"先做再说"
4. **不要凭猜，但也不要盲信 Hub**：查 Memory Hub 前先看真相源优先级；发现 Hub 里的信息与本文档冲突时，采信本文档并向 Ceci 报告冲突

---

## Part 9｜三条最高频踩坑

### 坑 1：把 Agent 当成 provider 的别名
- ❌ 所有居民共用一个 AgentModelBinding，靠 prompt 区分身份
- ✅ 每个居民有独立的 AgentModelBinding（agent_id + provider + model + 参数 + 故障状态）；底层 credential/base_url 可以复用（一把 key 支持多个 binding 合法），但 binding 必须独立

### 坑 2：把公共空间当成三个独立聊天
- ❌ Ceci 说话 → 分别给三个居民发独立请求 → 各自回复，居民之间不可见
- ✅ 公共 Conversation Timeline → 所有在场居民能看见彼此的发言 → 可以互相回应

### 坑 3：让后台小模型代替居民发言
- ❌ DeepSeek 便宜，用它生成 Lucien 的第一人称 Handoff
- ✅ 后台小模型只做摘要、分类、维护候选，绝不代替居民发言或写第一人称感受

---

## Part 10｜施工报告五问（每次完工必须回复）

Ceci 不写代码，报告用她能听懂的语言，不要堆技术术语。每问 1-3 句话。

### 1. 原来遇到的问题是什么？
不写"实现了 X 功能"，写"以前 X 不行，会导致 Y"。

**举例**：
- ❌ "实现了 Gateway 的 baseURL 参数"
- ✅ "以前所有 AI 只能走官方 API 地址，Ceci 用中转站的话根本连不上"

### 2. 以前房子怎么运行？
描述**用户视角的现状**，不描述代码。

**举例**：
- ❌ "GatewayService 只注册 anthropic 和 openai 两个静态 provider"
- ✅ "以前打开设置页面找不到任何地方配 API，也无法为每个 AI 单独指定用哪家模型"

### 3. 现在改成了什么？
用户视角。

**举例**：
- ❌ "新增 api_providers 表和 CRUD 路由"
- ✅ "现在设置页面能加中转站了，每个 AI 可以单独选自己用哪个中转站、哪个模型"

### 4. 小猫按哪几个按钮、问哪几句话，就能亲自看出区别？
**必须给出可复现的手动验收步骤**。让 Ceci 自己就能确认改动生效。

**举例**：
```
1. 打开留灯，进设置页面 → 点"添加 Provider"
2. 填入中转站地址、API key、起名"小克的中转站"
3. 保存后回到"AI 管理"tab，把小克的 provider 改成刚才那个
4. 到客厅 @ 小克说话，应该能收到回复
5. 把 Provider 改回原来的，重新说话，应该走原来的 endpoint
```

### 5. 哪些地方仍然没修好？
**必须说清楚哪些是本次没做、下次要做的**。不要报喜不报忧。

**举例**：
- Google/DeepSeek provider 还没实现
- API key 目前明文存 DB，加密还没做
- 设置页面 UI 没有测试连接按钮

---

### 报告发送时机

- 每个 PR 合并前发一次
- 每个施工单里程碑完成时发一次
- 遇到设计层面的偏离时立刻发（不要等做完）
