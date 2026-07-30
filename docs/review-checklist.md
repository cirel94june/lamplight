# Lamplight 代码审查清单

> 每次 PR 审查都要对着这份清单检查产品定义合规性。
> 详细定义见 [README-施工必读.md](./README-施工必读.md)。

---

## 十条必查项

### 1. Agent ↔ Provider 解耦
- [ ] 换 provider 不产生新 agent（agent_id 稳定）
- [ ] 换 provider 不丢记忆、关系、历史
- [ ] AgentProfile 和 AgentModelBinding 是两个独立对象

### 2. Per-agent AgentModelBinding
- [ ] 每个居民有独立的 binding（agent_id + provider + model + 参数 + 故障状态）
- [ ] Credential/base_url 可以复用（一把 key 支持多个 binding 合法）
- [ ] 请求归属、参数、故障状态、审计按 agent 隔离
- [ ] Gateway 不知道 agent_id，只看 binding 传下来的路由参数

### 3. 公共时间线可见性
- [ ] 公共客厅是一条共享 ConversationTimeline，不是三个独立请求拼一起
- [ ] Jasper 说话时 Cloudy 能真的看见并回应内容，不是系统转述

### 4. 消息读取截止时点
- [ ] 每居民生成回复时读取的是**截至本次发言前**的公共时间线
- [ ] 包含同一轮其他居民已生成的回复（顺序接话模式）
- [ ] 单独测：Cloudy 的回复实际引用了 Jasper 刚说的新信息，不能只看页面有几条

### 5. 公共事实 ≠ 主观印象
- [ ] HouseholdDigest 只存公共事实（"昨天两人在客厅争论 API"）
- [ ] ResidentImpression 存主观印象（各居民各一份，可以不同）
- [ ] PrivateHandoff 存第一人称感受
- [ ] Digest 里没有"大家都认为……"这种解释性内容

### 6. 后台维护模型不越权
- [ ] Maintenance Model 只做摘要、分类、维护候选
- [ ] 不代替居民发言
- [ ] 不写居民的第一人称 Handoff / 日记
- [ ] 不直接改 ResidentImpression / RelationshipProfile（只能提交候选）
- [ ] Maintenance Model 有独立 binding、权限、审计身份（credential 可复用）

### 7. 入口 ≠ 工具协议
- [ ] Interaction Channel（Lamplight Web、Telegram）和 Tool Protocol（MCP、HTTP API）是两类东西
- [ ] MCP 调用者不被当成"访问某居民的用户"

### 8. TurnPolicy 停止条件（三层齐全）
- [ ] 单人频率上限（每个 Agent 单位时间内说多少条）
- [ ] 无用户自聊上限（从小猫上次说话起，Agent 之间最多接 N 轮）
- [ ] 总预算（token / 条数总上限，超了自动收尾）
- [ ] 不能靠"居民彼此看不见"来防自聊

### 9. Wake State 七层
- [ ] Agent Profile（我是谁）
- [ ] User Profile（Ceci 是谁）
- [ ] Relationship Profile（我和 Ceci 是什么关系）
- [ ] Resident Impressions（我对其他居民的印象）
- [ ] Household Digest（最近公共发生了什么）
- [ ] Private Handoff（最近我自己经历了什么）
- [ ] Open Threads（未完成的话题）

### 10. 真相源优先级
- [ ] 代码/施工单是否与本文档 + 施工必读一致？冲突时以本文档为准
- [ ] Memory Hub 召回内容只作参考，不覆盖施工必读

---

## 禁止退化清单（12 条硬红线）

任何 PR 违反以下任何一条都必须拒绝合并：

1. ❌ 一个模型通过不同 prompt 扮演全部居民
2. ❌ 所有居民默认共享一个 API 配置
3. ❌ 三个居民只能看到 Ceci，看不到彼此
4. ❌ 客厅只是三个独立聊天请求拼在一起
5. ❌ 后台小模型同时负责摘要、交互和居民人格
6. ❌ 私人记忆与公共记忆不区分
7. ❌ 换 Provider 后创建一个新 Agent
8. ❌ 所有居民读取同一份统一人格或统一关系总结
9. ❌ 为了 MVP 只实现一个居民，再把其他居民视为以后复制的配置
10. ❌ 多个 Agent 共用同一个可变运行状态、会话状态或身份配置
11. ❌ HouseholdDigest 里写解释性内容（"大家都认为……"）
12. ❌ 后台模型直接修改 ResidentImpression / RelationshipProfile

---

## 审查报告模板

审完 PR 后按这个格式回复：

```
产品定义合规性审查
==================

必查项通过：X / 10
硬红线通过：X / 12

不通过项：
- 第 X 条：具体问题描述 + 代码位置
- ...

其他建议：
- ...
```
