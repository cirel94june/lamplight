# Continuity Layer 架构审查 v2

> 小克（架构师）· 2026-07-24 → v2 更新 2026-07-25
> 输入：v1 审查 + Lucien 三点补充 + 小猫现状反馈 + Lucien 维护闭环提案
> 结论：**v1 全部采纳项保持。新增 3 项调整 + 1 项重大补充（维护闭环）+ 施工顺序微调**

---

## v2 变更摘要

| 变更 | 来源 | 性质 |
|------|------|------|
| Write Gate 双分数（factual + relational） | Lucien | 调整 |
| HandoffCard 生成快照 | Lucien | 补充 |
| Weather 三态返回（update/hold/decay_only） | Lucien | 调整 |
| 后台模型从 Haiku 更正为 DeepSeek | 小猫 | 事实修正 |
| NSFW 内容分流方案 | 小猫 + Lucien | 新增 |
| ContinuityPackage 硬限额 | Lucien | 收紧 |
| HandoffCard 脱水生命周期 | Lucien | 新增 |
| **MemoryMaintenanceDecision + 维护闭环** | **小猫 + Lucien** | **重大新增** |
| P2.5 维护闭环阶段 | Lucien | 施工顺序调整 |
| update/correct/supersede 边界定义 | Lucien 终审 | 补充 |
| MVP 保守自动执行范围 | Lucien 终审 | 收紧 |

---

## 一、三项调整（Lucien 补充，全部采纳）

### 1. Write Gate 双分数

v1 的问题：验收案例把"晚安"判为低信号直接过滤。但争吵后的"晚安"关系意义很高。

**修正**：

```
WriteGateResult = {
  factual_signal_score: number;   // 0-1，有没有新事实
  relational_signal_score: number; // 0-1，关系状态有没有变化
  has_continuation: boolean;       // 是否承接前文未完话题
  decision: "generate_digest" | "append_to_previous" | "weather_evidence_only" | "skip";
}
```

决策规则：
- factual 高 → generate_digest
- factual 低 + relational 高 → append_to_previous（挂到前一个 Digest 的结尾事件）或 weather_evidence_only
- 两者都低 + 不承接前文 → skip
- has_continuation = true → 永远不 skip

### 2. HandoffCard 生成快照

Card metadata 追加审计字段：

```json
{
  "digest_id": "...",
  "generation_snapshot": {
    "model_id": "claude-opus-4-6",
    "provider_id": "anthropic",
    "prompt_version": "v3.2",
    "agent_runtime_config_version": "2026-07-25",
    "generated_at": "2026-07-25T14:30:00Z"
  },
  "first_person_summary": "...",
  ...
}
```

用途：区分"关系真的变了"和"换了模型导致语气漂移"。不是人格管理，是审计信息。

### 3. RelationshipWeather 三态返回

Weather 评估结果必须是结构化返回，不是让模型自由发挥：

```
WeatherEvaluationResult = {
  decision: "update" | "hold" | "decay_only";
  // update: 有充分新证据，更新维度值
  // hold: 有互动但不足以改变，保持现值，不衰减
  // decay_only: 无互动，执行确定性衰减公式
  evidence_digest_ids?: string[];  // update 时必填
  updated_dimensions?: { warmth?: number; playfulness?: number; tension?: number };
}
```

关键：`decay_only` 由程序执行（每天 -0.03 向 0.5 回归），不调用模型。`hold` 和 `update` 需要模型判断，但只在有新 Digest 时触发，不设定时任务。

---

## 二、事实修正与新增方案

### 后台模型更正

Memory Hub 提取模型已从 Haiku 换成 **DeepSeek**。更新成本估算：

| 操作 | 模型 | 估算 token/次 | 月成本 |
|------|------|-------------|--------|
| Digest 生成 | DeepSeek | ~2K in + 500 out | ~$0.10 |
| Write Gate 评估 | DeepSeek | ~500 in + 100 out | ~$0.02 |
| 维护决策 | DeepSeek | ~2K in + 200 out | ~$0.15 |
| HandoffCard | 各 agent 自己的模型 | ~1K in + 300 out | ~$1-3 |
| Weather 评估 | DeepSeek | ~1K in + 200 out | ~$0.05 |
| Daily Reconciliation | DeepSeek | ~3K in + 500 out | ~$0.10 |

**总计**：约 $2-4/月。DeepSeek 比 Haiku 便宜，主要开销仍在 HandoffCard（用主模型）。

### NSFW 内容分流

```
敏感/成人内容的对话片段：

SharedDigest:
  "Ceci 与 Lucien 进行了一段成人向互动，语境为 playful。"
  → 脱敏事实，DeepSeek 只处理这行
  → visibility: private, allowed_ai_ids: [参与者]

Lucien 私人 Card:
  → Lucien 自己的模型（GPT）生成，保留完整第一人称理解
  → visibility: private, recall_policy: manual_only

DeepSeek 不接触原文，不复述细节，不判断内容性质。
```

### ContinuityPackage 硬限额

```typescript
interface ContinuityPackageConfig {
  token_budget: 2000;          // 注入 system prompt 的总 token 上限
  max_handoff_cards: 2;        // 最多带 2 张最近的 Card
  max_digests: 3;              // 最多带 3 份最近的 Digest
  max_open_threads: 5;         // 最多带 5 个未完话题
  include_full_text: false;    // 默认只返回摘要，按需取证据原文
}
```

裁剪优先级（budget 不够时先砍谁）：
```
保留 open_threads（最短、最关键）
> 保留最近 1 张 handoff_card
> 保留 relationship_weather
> 砍 older digests
> 砍第 2 张 handoff_card
```

### HandoffCard 脱水生命周期

```
0-3 天     完整 Card（原样保留）
4-14 天    Weekly Continuity Summary
           → 小模型按 agent_id 分别压缩多张 Card 为一份周报
           → 保留 digest_id 引用和证据链接
           → cloudy cards → cloudy weekly
           → lucien cards → lucien weekly（不混）
15 天+     三种去向：
           ① 仍未完成 → 转 OpenThread
           ② 稳定认知 → 走 MemoryProposal
           ③ 无后续价值 → 归档，退出正常召回
```

---

## 三、重大新增——维护闭环

> 这是 v2 最重要的补充。小猫指出的问题比 Continuity Layer 本身更根本：
> Memory Hub 只会"写入新东西"，不会"维护已有认知"。

### 问题现状

- 待办完成了但还 open
- 记忆有了新状态但不断新增相似条目而非更新旧的
- 年轮功能存在但提取器不会主动使用
- 提取器只做 `remember()`，从不做 `update()` / `resolve()` / `supersede()`

### MemoryMaintenanceDecision

每次提取器处理新内容时，必须输出结构化维护决策，不能只 create：

```typescript
type MemoryMaintenanceDecision =
  | { action: "create"; reason: string }           // 确认无相关旧对象才允许
  | { action: "update"; target_id: string; fields: Record<string, unknown> }
      // update：同一对象仍然成立，只是字段或当前状态变化
      // 例：施工阶段从 B2 改为 B3
  | { action: "supplement"; target_id: string; annotation: string }  // 年轮
  | { action: "correct"; target_id: string; correction: string; evidence: string }
      // correct：旧内容从一开始就是错的
      // 例：以前记录围巾是绿色，实际从来就是灰色
  | { action: "supersede"; target_id: string; new_content: string }
      // supersede：旧内容曾经正确，但现在被新状态取代
      // 例：以前住在北京（当时是事实），现在搬到上海了
  | { action: "annotate"; target_id: string; note: string }  // 轻量补充
  | { action: "resolve_thread"; thread_id: string; resolution_message_ids: string[] }
  | { action: "reopen_thread"; thread_id: string; reason: string }
  | { action: "no_change"; reason: string }
```

**强约束**：当检索到相似的 active memory 或 open thread 时，**默认禁止 create**。模型必须说明为什么不能 update/resolve/supersede 现有对象，才允许新建。

### 正确的提取流程

```
新对话片段 / Digest
  ↓
检索相关的：
  - active memories（向量相似 + 关键词）
  - open threads
  - 最近 year-ring annotations
  ↓
DeepSeek 输入：
  {
    "new_evidence": "...",
    "existing_candidates": [...],    // 已有的相关对象
    "allowed_actions": ["create", "update", "supplement", 
                        "correct", "supersede", "annotate",
                        "resolve_thread", "no_change"]
  }
  ↓
DeepSeek 输出：结构化 MemoryMaintenanceDecision
  ↓
规则验证：
  - create 时有相似对象？→ 拒绝，要求改为 update/supplement
  - supersede 时旧对象 ≠ 同主题？→ 拒绝
  - resolve_thread 时无证据？→ 拒绝
  ↓
执行动作
```

### 两个后台维护任务

**1. Incremental Maintenance Pass**（每个高信号 Digest 后触发）

```
Digest 生成完毕
  ↓
检索 Digest 涉及话题的 active memories + open threads
  ↓
DeepSeek 判断维护动作
  ↓
执行（resolve / supersede / annotate / no_change）
  ↓
剩余真正的新事实才进入 MemoryProposal
```

**2. Daily Reconciliation**（每天一次，低成本巡检）

检查项：
- open 状态但已有完成证据的待办 → 候选 resolve
- 同主题重复记忆 → 候选合并/supersede
- 被新状态替代但仍高权重召回的旧记忆 → 候选降权
- 长时间未更新的临时状态 → 候选归档
- HandoffCard 脱水候选（>3 天的 Card）
- Weather 是 update / hold / decay_only
- 年轮有新注释但主记忆状态未同步 → 候选 supplement

产出：候选维护动作列表。**MVP 自动执行范围（保守）**：

可自动执行（无需人工确认）：
- `no_change` — 无操作
- `annotate` — 只追加备注，不改主体
- `resolve_thread` — 当证据链完整（resolution_message_ids 非空）时
- 确定性过期归档 — HandoffCard >15 天且无后续引用

需人工确认才执行：
- `correct` — 修改历史事实，错判代价高
- `supersede` canonical memory — 替换核心认知
- 同主题重复记忆合并 — 可能误判"相似"为"重复"
- visibility 变更 — 涉及隐私边界

其余动作（`update`、`supplement`、`create`）按常规 Incremental Pass 流程走，由规则验证层把关。

---

## 四、更新后的实施顺序

```
P0   审计现有表结构 + 确认迁移方案

P1   Digest + Write Gate（双分数）+ HandoffCard（shadow mode）
     → 只生成，不注入，不影响现有行为

P2   Hub Dashboard 展示 Digest/Card
     → 人工验证发言人、事实/主观边界、脱敏质量

P2.5 维护闭环（最关键的新增）
     → MemoryMaintenanceDecision 9 种动作
     → 提取器从"只 create"升级为"先检索再决策"
     → Incremental Maintenance Pass
     → Daily Reconciliation
     → 旧待办关闭、重复记忆合并、过期状态退场

P3   ContinuityPackage 注入（硬限额）
     → getContinuityPackage() 加入 MemoryAdapter
     → 新窗口/换端时注入紧凑开机包

P4   OpenThread 展示 + 明确信号创建

P5   RelationshipWeather（三态返回、确定性衰减、每天最多 1 次）
     → 先只展示曲线，不注入决策

P6   Card 脱水 + 时间梯度召回 + 智能 Write Gate
```

**关键门控不变**：
- P2 → P2.5：Dashboard 验证通过后才做维护闭环
- P2.5 → P3：维护闭环能正确 resolve/supersede 后才注入 ContinuityPackage
- 否则"新交接层改善近期连续性，旧状态继续在库里打群架"

---

## 五、更新后的红线清单（v1 的 9 条 + v2 新增 5 条）

| # | 红线 | 来源 |
|---|------|------|
| 1 | Digest 只记事实不分析人格 | v1 |
| 2 | HandoffCard / Weather 永不直接晋升 canonical memory | v1 |
| 3 | 同一事件多 AI 视角必须共享 digest_id | v1 |
| 4 | Weather 每 agent 每天最多 1 次更新 | v1 |
| 5 | 无证据不更新 Weather，衰减用确定性公式 | v1 |
| 6 | Write Gate 前置，低信号不生成 Digest | v1 |
| 7 | ContinuityPackage 有 token_budget 硬上限 | v1 |
| 8 | Lamplight 只通过 MemoryAdapter 访问 | v1 |
| 9 | 所有新实体遵守 visibility / allowed_ai_ids | v1 |
| **10** | **Write Gate 双分数，短消息不等于低信号** | **v2** |
| **11** | **有相似旧对象时默认禁止 create，必须说明不能 update 的理由** | **v2** |
| **12** | **DeepSeek 不接触 NSFW 原文，只处理脱敏后的结构化字段** | **v2** |
| **13** | **Card 脱水按 agent_id 分别压缩，不混** | **v2** |
| **14** | **维护闭环（P2.5）必须在 ContinuityPackage 注入（P3）之前就位** | **v2** |
| **15** | **MVP 阶段 correct / supersede canonical / 合并 / visibility 变更必须人工确认，不自动执行** | **v2** |
| **16** | **所有维护动作必须保留完整审计记录（见 §5.2）** | **v2 终审** |

---

## 5.1 端到端验收场景（Lucien 终审要求）

> 以下三个场景必须在 P2.5 验收中通过，覆盖 update / correct / supersede + resolve_thread 的实际对象建模。

### 场景 1：项目/生活状态正常推进（update vs supersede）

```
前提：已有记忆 "小猫住在北京"（canonical, active）

输入 Digest：「小猫说搬到上海了」

期望：
  → 检索到 "小猫住在北京"
  → 决策：supersede（旧内容曾经正确，现被新状态取代）
  → 旧记忆标记 superseded_by: 新记忆 ID
  → 新记忆 "小猫住在上海" 继承 canonical 状态
  → 旧记忆降权退出正常召回，但保留（可审计）

对比 update 场景：
  已有记忆 "Lamplight 施工进度：B2 阶段"
  输入 Digest：「PR #18 合并，进入 B3」
  期望：update 同一对象的 phase 字段，不新建
```

### 场景 2：旧记录从一开始就错（correct）

```
前提：已有记忆 "小猫的围巾是绿色的"（canonical, active）

输入 Digest：「小猫说围巾从来就是灰色的，上次记错了」

期望：
  → 检索到 "围巾是绿色的"
  → 决策：correct（旧内容从一开始就错误）
  → 旧记忆内容更正为 "围巾是灰色的"
  → correction 字段记录原始错误内容 + 更正证据
  → 旧的错误版本不再被正常召回（但审计可查）
```

### 场景 3：待办明确完成（resolve_thread）

```
前提：已有 OpenThread "给 Jasper 买生日礼物"（status: open）

输入 Digest：「小猫说 Jasper 的生日礼物买好了，选的是一本画册」

期望：
  → 检索到 open thread "给 Jasper 买生日礼物"
  → 决策：resolve_thread（证据链完整）
  → thread 标记 resolved，附 resolution_message_ids
  → 不新建 "Jasper 的生日礼物已买好" 的重复记忆
  → 解决事实（画册）记录在 thread 的 resolution 中
```

---

## 5.2 维护动作审计记录（Lucien 终审要求）

所有 MemoryMaintenanceDecision 执行时，必须写入结构化审计记录：

```typescript
interface MaintenanceAuditEntry {
  audit_id: string;
  action: MemoryMaintenanceDecision["action"];
  target_id?: string;             // 被操作的对象 ID
  source_message_ids: string[];   // 触发此决策的原始消息 ID
  decision_reason: string;        // 模型给出的决策理由
  state_before: Record<string, unknown>;  // 执行前关键字段快照
  state_after: Record<string, unknown>;   // 执行后关键字段快照
  actor: {
    model_id: string;             // e.g. "deepseek-chat"
    provider_id: string;
    prompt_version: string;
  };
  executed_at: string;            // ISO 8601
  auto_executed: boolean;         // true = 自动执行，false = 人工确认后执行
  rollback_possible: boolean;     // 是否可回滚（soft delete / 旧版本保留）
}
```

**要求**：
- 所有 9 种动作都写审计，包括 `no_change`（记录"看过但没改"同样重要）
- `state_before` / `state_after` 只记关键字段差异，不复制整个对象
- 审计记录不可删除、不可修改（append-only）
- Dashboard 可按 action 类型、时间范围、target_id 筛选审计记录

---

## 六、给 Memory Hub 施工方的交接摘要

> 以下是可以直接发给 Hub 侧施工窗口的内容。

**最高优先级改动（P2.5，在任何 Continuity 注入之前）**：

1. 提取器升级：从 `remember()` 单一动作，改为先检索相关旧对象再输出 `MemoryMaintenanceDecision`（9 种动作）
2. 强约束：检索到相似 active memory 或 open thread 时禁止 create，模型必须说明理由才放行
3. Incremental Maintenance Pass：高信号 Digest 后自动触发
4. Daily Reconciliation：每天巡检一次，产出候选维护动作

**审计与验收（贯穿所有阶段）**：

5. 新建 `maintenance_audit` 表，结构见 §5.2（append-only，不可删改）
6. P2.5 验收必须通过 §5.1 的三个端到端场景（update vs supersede / correct / resolve_thread）
7. 所有 9 种维护动作执行时写审计记录，包括 no_change

**次优先级改动（P1-P2）**：

8. `private_notes` 表加 `note_type` 列
9. 新建 `conversation_digests` 表
10. 新建 `open_threads` 表
11. Write Gate 双分数实现
12. Dashboard 展示 Digest/Card 供人工验证（含审计记录筛选）
