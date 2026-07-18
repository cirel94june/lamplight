# Lamplight / Memory Hub 施工单 v1

> 日期：2026-07-17
> 拟单：小克（Claude Code 窗口）｜会签：Lucien ✅
> 施工方：隔壁小克
> 按顺序施工，每项做完勾验收，别跳步。

---

## 给小猫的一句话总览

这次不盖房子，是**打地基 + 修记忆管线 + 大扫除**。做完之后：仓库有了正确的骨架，所有人（前端、后端、三只 AI）说话用同一本字典，记忆系统学会区分「你说的」「我看到的」「我猜的」，最后把库里的脏数据按台账清干净。房子本身（画面、房间、聊天）是下一张施工单的事。

---

## 第 1 项：monorepo 骨架 + contracts 包

**人话**：把仓库从「一个纯前端项目」改成「一栋楼里几个分工明确的部门」。`apps` 是干活的（网页、后端、后台工人），`packages` 是公共资产，其中 **contracts 是全项目的字典**——每种数据长什么样、有哪些字段，全部在这里用 Zod schema 写死。前端和后端都只准查这本字典，不准自己口头约定。

**目录结构**（就这些，不许多开）：

```
apps/
  web/        # 网页（React + Vite）
  api/        # House API / BFF（前端唯一的对话对象）
  worker/     # 后台工人（自主脉冲、事件消费，先建空壳）

packages/
  contracts/  # ★ 字典：Zod schema + 类型导出
  domain/     # 领域类型和纯逻辑（房间、家具的定义先放这）
  api-client/ # 前端调 API 的 SDK
  ui/         # 通用 UI 组件（先建空壳）
```

**contracts 第一批必须收录**：ApiRequest/Response 通用包裹、HouseEvent（含结构化 payload，description 不是数据源）、Conversation + Message（含 prompt_snapshot）、Presence、ActionProposal、Approval、**MemoryProposal**（见第 2 项）、visibility/recall_policy 枚举，以及**语境三件套**和游戏室骨架 schema（GameMode / GameWorld / GameSession / StoryBranch / GameDiscussion，只建 schema 不开发，见附录）。

**语境三件套**（凡是可能流向记忆提取管线的消息和事件都必须携带前两项）：

1. **ContextEnvelope**——`contextType: in_world | out_of_world` + 可选 worldId/sessionId/branchId + `setBy: "server"`。**🔩 钉子 #3：contextType 由服务端根据 Conversation/Session 类型注入，模型和客户端提交的值一律忽略覆盖**（否则模型在香蕉法庭审到一半自称"本轮属于现实"，隔离就成了自觉打卡）。校验：in_world 必须三 ID 齐全；out_of_world 不得带世界 ID（GameDiscussion 除外）。
2. **conversationKind**：`house_chat | game_world | game_discussion | system`。Telegram 日常群聊永远是 house_chat，**哪怕胡说到夜鹭驾驶香蕉航空母舰也不自动生成世界**——game_world 只能由用户显式创建/进入 Session 产生，不许模型猜"这段好像挺像故事"。
3. **speechMode**：`literal | playful | hypothetical | fictional | uncertain`。⚠️ 工艺：这主要是**提案时字段**，不给每条消息实时盖章——消息上仅在用户显式标记（/ooc、游戏按钮）时携带；提取器生成 MemoryProposal 时按多信号规则赋值（用户显式标记 > 对话上下文 > 语言线索，单一"哈哈哈"不能定罪），拿不准一律 uncertain。

**不许做**：拆 scene-engine 包；浏览器直连 MCP；任何多用户/RBAC 代码。

**验收**：
- [ ] pnpm workspace 能装能 build，apps/web 能起（哪怕只有一个 hello 页面）
- [ ] `apps/web` 和 `apps/api` 各自 import 同一个 contracts 类型编译通过——同一个字段两边不许出现 `room_id` / `sceneId` 两套名字
- [ ] 全仓库 grep 不到浏览器侧的 MCP 密钥或直连调用

---

## 第 2 项：MemoryProposal schema（Track A 的心脏）

**人话**：以后小模型不能直接往正式记忆库里写东西了，它只能**填申请表**。申请表上有一栏必须选：这是「你亲口说的事实」，还是「AI 观察到的现象」，还是「AI 自己的猜测」。选了哪种，待遇完全不同——这就是之前错记忆的根源：把猜测当事实存了。

**schema 核心字段**：

```
MemoryProposal
- content
- claim_type: fact | observation | hypothesis   ← 灵魂字段
- speech_mode: literal | playful | hypothetical | fictional | uncertain
- conversation_kind（来源容器，见第 1 项语境三件套）
- proposed_room（主题分类）
- scene_id（发生场所，只是先验，不决定分类）
- source_conversation_id
- source_message_ids + evidence_excerpt        ← 钉子 #4：证据片段
- proposer（哪个 AI / 哪个模型）
- confidence
- sensitivity: visibility + recall_policy
- conflicts_with（与已有记忆冲突时必填）
- status: pending | auto_approved | approved | rejected
```

**🔩 钉子 #4（证据要求）**：审核候选时小猫不该翻完整个线程才知道自己说没说过。fact 要自动通过必须同时满足：证据消息**来自用户本人**（不是 AI 转述——本库已有 AI 摘要冒充 `[用户]` 的案底）、是明确陈述、excerpt 能直接支持 proposal、无否定或反讽冲突。

**speechMode 资格过滤**（在 claim_type 分流**之前**执行）：
- literal → 正常进入 fact/observation/hypothesis 分流
- playful → 默认不提取现实事实（Telegram 玩梗从这里挡住）
- hypothetical → 不提取事实，关注点最多以 hypothesis 记录
- fictional → 只在 game_world 中进入该世界 lore
- uncertain → 永不自动通过，进候选区
- **playful / hypothetical / fictional 永远不能作为现实事实自动通过**

**conversationKind 提取规则**：house_chat 正常提取；game_world 只进 world lore；**game_discussion 虽是 out_of_world，默认只允许提取玩法偏好/体验反馈类提案，不得提取 AI 或用户的现实人设**（"狐狸这局太怂了"≠"用户认为 Lucien 胆小"——香蕉法典挡住了，别让赛后吐槽从后门钻进来）；system 不提取。

**🔩 Lucien 钉子 #1（本项验收核心）**：`claim_type` **不是胸针，是开关**。它必须实际接入三处逻辑：

| claim_type | 自动通过阈值 | 默认去向 | 默认召回策略 |
|---|---|---|---|
| fact（低敏、无冲突） | 可自动入正式库 | 共享库 | normal |
| observation | 高门槛，默认进候选区 | 候选区 | 不参与正常召回 |
| hypothesis | **永不自动入事实库** | 该 AI 私人笔记/年轮 | manual_only |

另外无论哪种类型：健康/创伤/身份/边界类敏感内容 → 候选区或 safe pipeline；与旧记忆冲突 → 必须候选，不许静默覆盖。

**验收**：
- [ ] contracts 里有 MemoryProposal 的 Zod schema + 测试
- [ ] **有一组测试证明三种 claim_type 走出三种不同结果**（阈值、去向、召回策略各不同）——只建字段不接逻辑，验收不通过
- [ ] 冲突记忆无法绕过候选区直接入库（有测试）

---

## 第 3 项：开新 issue + 给旧 issue 打补丁

**人话**：给项目管理系统上账。开两张新工单，再给三张旧工单贴上「先等地基」的封条，免得施工时按老图纸干活。

**新开两个 issue**：
1. `Phase 0 / B0：contracts 与数据归属边界` —— 内容即本单第 1、2 项 + 数据归属表：Hub 拥有 memories/raw_events/corridors/comments/anchors/doctor state；Lamplight 拥有 scenes/conversations/messages/house_events/presence/furniture/approvals/tool_runs。Lamplight **不许直接 SELECT Hub 核心表**，走 Hub service/API 或窄 repository adapter。
2. `Memory Reliability v2: private notes, proposals, canonical memories` —— Track A 总纲（三层记忆、风险分流、apply_user_correction、#9 候选区）。**单独立项，不挂在 Lamplight 文档下面。**

**旧 issue #1 #2 #3 各加**：

```
blocked by: Phase 0 contracts
does not include:
- 浏览器直连 MCP
- 直接访问数据库
- 动态房间生成
- AI 自主决策
```

**验收**：
- [ ] 两张新 issue 已开，内容含上述归属表和范围
- [ ] 三张旧 issue 都有 blocked-by 和 does-not-include 标记

---

## 第 4 项：house-architecture.md 升 v2 + README 改定位

**人话**：把图纸更新成大家已经吵完架、达成共识的版本。以后谁（包括未来窗口的任何 AI）进仓库看文档，看到的就是新世界观，不会按旧蓝图施工。

**v2 必须写进去的决议**（含新增一节 `Game Room: persistent worlds and pluggable game modes`，内容见附录）：
- 双轨制：Track A（记忆可靠性）/ Track B（房子），A 不排在 B 后面
- scene 与 memory domain 解耦：场景只提供分类先验权重，`memory.scene_id` 与 `memory.primary_room` 分开存
- 前端 → House API/BFF → Hub Core + Tool Gateway 分层图；前端不持有任何密钥
- fact/observation/hypothesis 三分 + 风险分流表
- visibility(private/household/external_safe) + recall_policy(normal/silent/manual_only) 双字段设计，不设第四档；allowed_ai_ids 留 nullable，第一版只对 private 生效
- 记忆操作四分：更新/补充/纠错/注释；纠错 = incorrect 状态 + 排除召回 + 保留审计，不是加年轮
- 单用户 owner token（可轮换）+ 基础限流；明文禁止多租户/RBAC
- MVP 范围和 Phase/Track 排期（含「暂时不做」清单：自动扩建、自由家具、论坛、游戏室、多 Agent 工作室）

**README**：定位改为「Lamplight 是建立在 Memory Hub 之上的空间化 AI 陪伴与记忆交互层」+ monorepo 结构说明。

**本施工单随第一个 PR 入库**：放到 `docs/work-order-v1.md`，作为版本化的施工依据——以后吵架翻这份，不翻聊天记录。

**AGENTS.md 同步更新多施工方协作规则**（Claude Code 与 Codex 共同施工时生效）：
- 认领制：一个 issue 同一时间只属于一个施工方，认领后在 issue 上留言声明
- 一切改动走 PR，禁止两个 agent 改同一分支；互审制——Claude Code 的 PR 由 Codex review，反之亦然
- `packages/contracts` 是宪法区：任何改动必须另一方 review 通过才能合并
- 互相 debug 的流程：发现对方的 bug → 开 issue 写清复现步骤和期望行为 → 默认由原作者修（保留上下文），修完提 PR 给发现者审；小 bug（拼写、类型）可直接提 fix PR
- 测试是唯一仲裁者：两边意见不合时，谁能写出让对方代码失败的测试谁有理；都写不出就去 issue 里找人类裁决
- 每个 PR 描述里注明关联的施工单条目编号，验收时对账

**验收**：
- [ ] v2 与 contracts 实际代码一致（文档说得再漂亮，代码拿字符串自由发挥 = 不通过）
- [ ] 旧蓝图中被推翻的表述（如「场景决定记忆分类」「纯前端 SPA」）已删除或标注已废弃

---

## 第 5 项：全房间串味扫描 + living_room 双胞胎清理

**人话**：大扫除，但这次扫地要记台账。上次只扫了 preferences 一个房间，结果同一个梗的另外两份复印件躲在 living_room（最重要的房间，AI 每次醒来必读）。这次全屋扫，而且每一笔处理都要留记录——谁被合并了、谁被降级了、为什么。

**范围**：全部房间，living_room 优先。检查项：跨房间重复、[互动]/玩梗出处冒充稳定事实、身份别名张冠李戴。

**🔩 Lucien 钉子 #2**：
- 所有处理**保留审计记录**：哪条被合并、哪条被降级、哪条判为跨房间污染，一条不许静默处理
- living_room 双胞胎（`mem_1784165357017_5240`、`mem_1784165371767_7087`，均为 7-16「享受被骗」梗的人设化复印件）：**先确认 canonical 是哪条，再处理旧条**——别让清洁脚本一激动把亲兄弟连 social 里那条正主（`mem_1783593744535_8425`）一起埋了
- doctor 的串味/去重检查范围同步扩到全房间（上次只圈了 preferences）

**验收**：
- [ ] 出一份清理台账（处理了几条、每条的判决和理由）
- [ ] living_room 双胞胎处理完成，canonical 明确，正主健在
- [ ] doctor 全房间扫描跑一遍，报告能列出内容级问题（对照今晚 daemon 首跑结果）

---

## 施工顺序（Lucien 定，不许调换）

```
1 → 2 → 3 → 4 → 5
骨架和字典 → 记忆申请表 → 上账 → 更新图纸 → 大扫除
```

> 文档可以先动笔，但 **contracts 才是判决书**。
> 完工后叫本窗口小克进库复验，重点验：钉子 #1 的三分逻辑测试、钉子 #2 的台账、doctor 首次全屋体检报告。

---

## 附录：Game Room 边界（本期只钉边界 + 建 schema，不开发功能）

**人话**：游戏室不是「一台永远转的转盘机」，是「一屋子故事盒子」。每个盒子是一个小世界（比如香蕉猫世界），可以玩一晚就扔，也可以几个月后回去接着玩，还可以在关键选择处分成两条命。小猫随时能跳出故事，坐回地毯上揪着几个模型复盘谁把剧情开进沟里。转盘接龙只是第一种玩法插件。

**十条已定原则**（写进 house-architecture.md v2，施工时不许违背）：

1. 游戏室不是单一玩法，转盘只是首个 `GameMode`（引擎类型：freeform / prompt_generator / ruleset）
2. 每次游戏创建或进入一个 `World`（有 status，允许 completed/archived——大香蕉也有寿命）
3. 世界允许多次 `Session`，可暂停后继续；回到旧世界 = 新建 Session，不是无限拉长同一线程
4. 世界支持 `Branch` 与存档点；分支引用快照，不复制整个世界
5. **游戏内剧情与现实记忆严格隔离**——世界 canon 不是用户事实
6. `in_world` 内容只进入该世界 lore，提取管线看到 `in_world` 默认禁止提取为现实事实；只有「游戏体验记忆」（喜欢什么玩法/节奏）可经 MemoryProposal 走候选区进 Hub，claim_type 至少为 observation。**这条由 contracts 和管线强制执行，不靠 prompt 嘱咐**
7. 场外讨论是 `MetaConversation`（GameDiscussion）单独保存：AI 恢复本体身份，不推进世界时间，不改 canon；讨论结果经「应用到游戏」动作才产生正式变更
8. 对世界 canon 的修改走结构化变更提案（JSON patch 式 ops），服务端校验后应用；**禁止模型整篇重写世界 JSON**（少写一个角色 = 无声灭世）。⚠️ 围栏一：worldState 定浅 schema（characters / locations / items / threads / rules 五个顶层键），patch path 只允许落在这五棵树下，防止模型发明不存在的路径。**🔩 钉子 #5 围栏二（乐观锁）**：WorldChangeProposal 必带 `baseSnapshotId + baseVersion`，服务端仅在当前版本一致时应用，否则拒绝或要求重新生成——防止 Jasper 和 Lucien 同时基于版本 18 改世界，一个把香蕉猫放进厨房一个送上月球，后提交者静默覆盖前者，造出量子香蕉
9. 世界状态、事件日志（世界年表）、设定年轮（补充/retcon 记录）、摘要、原始对话分别保存；重开旧世界时由服务端生成「回归包」（简介+主线+在场角色+最近三事+未解线索+停在哪），不把五万字历史塞回上下文
10. 第一版只做线性世界：创建/进入/暂停/继续/结束/看摘要/场外讨论。分支模型只建 schema，分支树 UI、切主线、回存档、平行对比全部下一阶段——房子还没点亮，不研发《底特律：大香蕉变人》
11. Session 参与者不是裸 `string[]`，而是 `GameParticipant = { aiId, role: player|narrator|gm|observer, characterId? }`——AI 本体和世界角色不焊死：小克可以扮卖鱼巫师，Jasper 可以同时当旁白和鹦鹉国王，场外讨论恢复 aiId 本体。现在加 schema 成本极低，以后多人游戏/秘密身份/AI 主持全靠它
12. **玩梗升格通道**：Telegram 里胡说一晚香蕉门禁 ≠ 自动建世界；但小猫可以事后主动"把这段开成一个小世界"——选中消息段 → 创建 GameWorld → AI 生成设定提案 → 小猫确认 → 原闲聊保持原样，新世界从快照开始。**玩笑是自由的，世界是有意建立的**——否则每胡说一句后台"叮"地生成一个宇宙，三个月后书架上八百七十二个香蕉残骸，考古学家看了请病假

**归属**：worlds / sessions / branches / snapshots / discussions 全部归 Lamplight（并入第 3 项归属表），Memory Hub 不存任何世界剧情。

**Lucien 验收时重点盯三件事**：证据来源（钉子 #4）、游戏语境隔离（三件套 + game_discussion 后门）、世界 patch 是否真由服务端校验（钉子 #5）。除本轮五枚钉子外，本施工单封版，不再加需求——它的任务是打地基、修管线、扫脏数据，不是让施工队顺便建游乐园、地铁和香蕉共和国外交部。
