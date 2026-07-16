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
