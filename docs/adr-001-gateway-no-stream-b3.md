# ADR-001: B3 Gateway 契约不预定义 stream()

> 状态：已裁决（2026-07-24）
> 裁决人：小猫（项目 owner）
> 背景：Codex review PR #18 指出蓝图§2 提及"流式输出"，但 Gateway 接口只有 `complete()`

## 决定

B3 MVP 阶段 Gateway 契约只保留 `complete()`，**不预定义 `stream()` 方法**。

## 理由

流式响应的接口形状取决于实现方案（SSE、WebSocket 帧、AsyncIterator），
现在定了大概率后面要改。contracts 是宪法区，改一次成本高。
等 B3 MVP 跑通后，根据实际体验再决定流式怎么做、接口长什么样。

## 后续

- B3 第 2 项（Gateway 实现）按非流式 MVP 施工
- 流式支持在 B3 完工后单独立项，届时一并设计契约和实现
