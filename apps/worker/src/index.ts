import type { HouseEvent } from "@lamplight/contracts";

/**
 * 后台工人（空壳）：自主脉冲、事件消费以后住在这里。
 * 现在只证明它和其他人查的是同一本字典。
 */
export function handleEvent(event: HouseEvent): void {
  console.log(`[lamplight-worker] event ${event.type} (${event.id}) — 壳还没长内脏`);
}

console.log("[lamplight-worker] shell ready, nothing to do yet");
