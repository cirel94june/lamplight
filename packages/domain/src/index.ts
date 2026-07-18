export * from "./memory-triage.js";

/**
 * @lamplight/domain：领域类型和纯逻辑。
 * 房间、家具的定义先放这里；渲染细节归 apps/web，数据形状归 contracts。
 */

/** 房子里的一个场景（房间）。scene 只提供记忆分类的先验权重，不决定分类。 */
export interface Scene {
  id: string;
  /** 场景种类，如 bedroom / living_room / study / game_room / counseling_room */
  kind: string;
  name: string;
  /** 属于某个 AI 的私人房间时填 ai_id */
  owner_ai_id?: string;
}

/**
 * 家具是数据驱动的 SVG 组件：AI 只输出选型 + 参数，
 * 绘画资产由人工维护在组件库里。
 */
export interface Furniture {
  id: string;
  scene_id: string;
  /** 组件库里的选型 key */
  type: string;
  params: Record<string, unknown>;
}
