# 施工单 v2 — 让房子活起来（Track B: B1 + B2）

> 版本：v2 draft（2026-07-21）｜拟定：小克（架构师会话）｜待小猫盖章
> 前置：施工单 v1 已全部完工（PR #4/#5/#8/#9/#11 合并，75 测试全绿）。
> 目标：从"有字典的空仓库"变成"能跑起来、能看到房子、能看到 AI 在哪"的最小可用系统。
> 蓝图依据：docs/house-architecture.md v2.1

## 现状

已有：contracts 字典（11 个 schema 文件）、domain 纯逻辑（memory-triage）、placeholder 前端。
没有：数据库、API 路由、WebSocket、真实 UI——apps/api 和 apps/worker 是空壳，apps/web 只有一行"小克在打盹"。

## 条目

### 第 1 项 · BFF 骨架 + 数据库 + 鉴权

**做什么**：让 apps/api 成为一个能跑的服务器。

- 选型：Hono（轻、类型好、适合 monorepo）或 Express——施工方自选，但选了就定，不来回换
- SQLite（better-sqlite3）做本地开发数据库，migration 框架（drizzle-kit 或 kysely）
- 建表：scenes、house_events、ai_presence（字段对齐 contracts schema）
- owner token 鉴权中间件（v2.1 §9：单用户 bearer auth，token 从环境变量读）
- 健康检查端点 `GET /health`
- **不做**：WebSocket（第 4 项做）、前端（第 5 项做）、Memory Hub 连接

**交付标准**：`pnpm --filter @lamplight/api dev` 能启动，`curl /health` 返回 200，带 token 的请求通过、不带的 401。

**PR 分支**：`feat/b1-api-skeleton`

### 第 2 项 · Scene 注册表 + 七个固定房间

**做什么**：把房子的房间定义为数据。

- **Scene 是空间上下文，不等于固定房间。** 当前七个房间是 Room Scene（type=room），以后游戏世界、临时场景也是 Scene（type=game_world / ephemeral 等）。schema 的 type 字段用 string 不用枚举，留扩展空间。
- Scene schema 已在 contracts 有引用但未独立定义——在 contracts 补 `scene.ts`：SceneDefinition（scene_id、display_name、type: string、prompt_weight_overrides、max_participants?、furniture_slots?）
- 七个固定房间作为种子数据（seed）写入 scenes 表：小猫卧室、小克卧室、Lucien 卧室、Jasper 卧室、客厅、书房、心理咨询室
- 每个房间带 prompt_weight_overrides（如心理咨询室：`{ psychology: 0.35 }`）
- API 端点：`GET /scenes`（列表）、`GET /scenes/:id`（详情）
- **不做**：动态创建/删除房间（MVP 固定房子）、家具系统

**交付标准**：`GET /scenes` 返回 7 个房间，每个有 id、名称、prompt 权重。

**PR 分支**：`feat/b1-scenes`

### 第 3 项 · house_events + ai_presence API

**做什么**：让房子有动态和在场状态。

- **house_events 是领域事件，不只是 UI 动态流。** event_type 是开放 string（不是枚举），payload 是 JSON——未来 Agent Runtime、Tool Gateway、Game Session、塔罗等模块都通过事件连接房子，不需要改 schema。actor 字段用 agent_id 标识，不用展示名。
- house_events CRUD：
  - `POST /house-events`（写入，校验 context + conversation_kind，对齐 contracts houseEventSchema）
  - `GET /house-events`（分页列表，支持 since 时间戳过滤）
- ai_presence：
  - `PUT /presence/:ai_id`（更新状态，校验 presenceSchema）
  - `GET /presence`（全部 AI 当前状态）
  - 服务端过期规则：updated_at 超过阈值（可配，默认 30 分钟）的 active 自动视为 idle（查询时计算，不起定时任务）
- **不做**：实时推送（第 4 项做）、前端（第 5 项做）

**交付标准**：能通过 API 写入事件、更新 presence、查询动态流。集成测试覆盖鉴权、校验、过期逻辑。

**PR 分支**：`feat/b1-events-presence`

### 第 4 项 · WebSocket 实时推送

**做什么**：前端能实时看到房子里发生的事。

- WebSocket 端点 `/ws`（带 owner token 鉴权）
- 事件类型：`house_event`（新事件发生）、`presence_update`（AI 状态变化）
- 第 3 项的写入端点在成功后广播给所有 WebSocket 连接
- 心跳 + 断线重连协议（最简：ping/pong + 客户端自动重连）
- packages/api-client 里封装 WebSocket client hook（React 可用）
- **不做**：SSE 备选方案（先只做 WebSocket，够了再说）

**交付标准**：两个浏览器标签页同时连接，一个写入事件/更新 presence，另一个实时收到推送。

**PR 分支**：`feat/b2-websocket`

### 第 5 项 · 静态房屋前端 + 动态流

**做什么**：打开浏览器能看到房子。

- 俯视视角房屋布局（7 个房间的 SVG 网格，数据驱动——从 `GET /scenes` 拿房间列表）
- 每个房间显示在场 AI 头像/状态指示器（从 `GET /presence` + WebSocket 更新）
- 右侧或底部：动态流面板（house_events 时间线，WebSocket 实时追加）
- 点击房间高亮（先不进入聊天，那是 B3）
- 昼夜光线效果（issue #3 的最简版本：根据本地时间切换 CSS 主题，白天暖色、夜晚深色）
- **不做**：房间内聊天（B3）、家具渲染、自主脉冲

**交付标准**：浏览器打开能看到 7 个房间的俯视图，AI 头像在房间里，动态流实时滚动。开发服务器 `pnpm --filter @lamplight/web dev` 能跑。

**PR 分支**：`feat/b2-house-ui`

## 流程

与 v1 相同：一项一项做 → PR → Codex 审 → 架构师验 → 小猫合并。
contracts 改动（第 2 项的 scene.ts）属宪法区，须 Codex review 通过。

## 不在本单范围

- B3 conversation（聊天功能，下一期施工单）
- Agent Runtime / AI Gateway / Channel Adapter（需要先有聊天才有意义）
- Memory Hub 连接（Track A 进度独立）
- 家具系统、小手机、塔罗/星盘（issue #10 远期）
- 部署/CI（先本地开发跑通）

## 技术约定补充

- 数据库 migration 文件放 `apps/api/migrations/`，种子数据放 `apps/api/seed/`
- API 路由按 domain 分文件：`routes/scenes.ts`、`routes/events.ts`、`routes/presence.ts`
- 所有 API 入参用 contracts schema 校验（zod parse），不在路由里重新定义类型
- 前端组件放 `apps/web/src/components/`，房间布局组件叫 `HouseMap`，动态流组件叫 `EventFeed`
- SVG 房间是数据驱动的组件，不是手画的静态图——房间数据从 API 来，组件根据数据渲染位置和大小
