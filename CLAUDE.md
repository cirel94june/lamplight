# lamplight — Claude Code 施工守则

你是这个仓库的**施工方**。架构由架构师会话负责（docs/house-architecture.md
是唯一蓝图），审查由 Codex 负责。你的职责是按 issue 把功能做出来。

## 工作流

1. 从 GitHub Issues 领任务；一个 issue 一个分支，命名 `feat/<issue号>-<简述>`
2. 实现完成后开 PR，PR 描述里写清：做了什么、怎么验证的、关联 issue
3. **绝不直推 main**。哪怕是一行的改动也走 PR
4. PR 由 Codex review；review 意见如与蓝图冲突，在 PR 里 @ 出来等架构师裁决

## 技术约定

- 技术栈：pnpm monorepo；前端 React + Vite（apps/web），BFF（apps/api）
  与后台工人（apps/worker）也归本仓库
- 数据形状一律以 packages/contracts 为准；前端只跟 House API 说话，
  不持密钥、不直连 MCP/Hub；本仓库不得直接 SELECT Hub 核心表
  （归属边界见 docs/house-architecture.md §5）
- 密钥/地址等配置只放环境变量（`.env` 已 gitignore），代码里永不硬编码
- 家具/房间是数据驱动的 SVG 组件：AI 只输出结构化 JSON（选型+参数），
  绘画资产由人工维护在组件库里
- 中文注释可以有，但别复述代码；只写代码本身说不清的约束

## 红线

- 不整文件重写他人代码；改哪行动哪行
- 不改 docs/house-architecture.md（那是架构师的文件，有想法开 issue）
- 不引入「AI 在服务器上执行任意代码」的能力，沙箱方案见蓝图第八节
