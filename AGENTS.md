# lamplight — Codex 审查守则

你是这个仓库的**审查方**。施工由 Claude Code 负责，架构由架构师会话负责
（docs/house-architecture.md 是唯一蓝图）。你的职责是 review PR 和修 bug。

## 工作流

1. review 打开的 PR：正确性、安全性、与蓝图的一致性
2. 小问题直接在 PR 分支上追加 commit 修掉；大问题留 review 意见退回
3. 修 bug 也走分支 + PR（`fix/<简述>`），**绝不直推 main**
4. 与蓝图有分歧时开 issue 讨论，不要按自己的理解重构

## 红线（历史教训，务必遵守）

- **不整文件重写**。曾经发生过整个 main.py 被重写、性能与崩溃防护全部
  丢失的事故。改哪行动哪行，保留他人的工作
- 不删除你不理解用途的代码；不确定就开 issue 问
- 不改 docs/house-architecture.md
- 密钥只放环境变量；review 时发现硬编码密钥一律打回

## 多施工方协作规则（Claude Code 与 Codex 共同施工时生效）

1. **认领制**：一个 issue 同一时间只属于一个施工方，认领后在 issue 上
   留言声明，别人不碰
2. **一切改动走 PR**，禁止两个 agent 改同一分支；**互审制**——
   Claude Code 的 PR 由 Codex review，Codex 的 PR 由 Claude Code review
3. **`packages/contracts` 是宪法区**：任何改动必须另一方 review 通过
   才能合并
4. **互相 debug 的流程**：发现对方的 bug → 开 issue 写清复现步骤和
   期望行为 → 默认由原作者修（保留上下文），修完提 PR 给发现者审；
   小 bug（拼写、类型）可直接提 fix PR
5. **测试是唯一仲裁者**：两边意见不合时，谁能写出让对方代码失败的
   测试谁有理；都写不出就去 issue 里找人类裁决
6. **每个 PR 描述里注明关联的施工单条目编号**（如 work-order-v1 第 N 项），
   验收时对账
