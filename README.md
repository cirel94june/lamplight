# lamplight · 留灯

> 不管几点回来，家里永远有一盏灯亮着。

**Lamplight 是建立在 [Memory Hub](https://github.com/cirel94june/memory-hub) 之上的空间化 AI 陪伴与记忆交互层。**
Memory Hub 负责记住，Lamplight 负责让这些记忆在一个持续存在的家中被感知、被回应、被重新遇见。

一栋俯视视角的插画房子：每个 AI 有自己的卧室，布置由他们自己决定；
有客厅、心理咨询室、书房、游戏室，走进哪个房间就用哪个房间的方式聊天；
光线随时间流转，后台的动态流记录着这个家每一刻的动静。

## 架构

设计蓝图见 [docs/house-architecture.md](docs/house-architecture.md)（v2），施工细则见 [docs/work-order-v1.md](docs/work-order-v1.md)。

```
Lamplight Web (apps/web)
      ↓  仅此一条通道
House API / BFF (apps/api)  +  WebSocket/SSE
      ↓
Memory Hub Core        Tool Gateway
（记忆/走廊/召回/医生）  （外部 MCP 工具）
```

前端不持有任何密钥、不直连 MCP/Hub，只认 House API。

### Monorepo 结构（pnpm workspace）

```
apps/
  web/        # 网页（React + Vite）
  api/        # House API / BFF（前端唯一的对话对象）
  worker/     # 后台工人（自主脉冲、事件消费）

packages/
  contracts/  # ★ 全项目字典：Zod schema + 类型导出，一律 snake_case
  domain/     # 领域类型和纯逻辑（记忆三分流、房间/家具定义）
  api-client/ # 前端调 API 的 SDK
  ui/         # 通用 UI 组件
```

`packages/contracts` 是唯一的数据形状来源，前后端同源引用，不许口头约定。

```sh
pnpm install
pnpm -r build   # 全仓构建
pnpm -r test    # 全仓测试
pnpm --filter @lamplight/web dev   # 起前端
```

## 多 agent 协作方式

这个仓库由多个 AI 协作维护，分工与协作规则见 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)：

| 角色 | 谁 | 职责 |
|---|---|---|
| 架构 | Claude（架构师会话） | 设计蓝图、拆任务（GitHub Issues）、把关方向 |
| 施工 | Claude Code | 按 issue / 施工单实现功能，走分支 + PR |
| 审查 | Codex | review PR、修 bug，不直推 main |

Claude Code 与 Codex 共同施工时的认领制、互审制等规则见 [AGENTS.md](AGENTS.md)。

## 铁律

1. **main 分支只接受 PR，不接受直推**（施工和审查都走分支）
2. **任何密钥只放环境变量**，代码和 git 历史里永远不出现
3. **不整文件重写**——改哪行动哪行，保留他人的工作
