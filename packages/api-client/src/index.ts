import type { z } from "zod";
import { apiResponseSchema, type ApiResponse } from "@lamplight/contracts";

export { HouseWsClient, type WsMessage, type WsMessageType, type WsStatus, type WsListener, type WsStatusListener, type HouseWsOptions } from "./ws.js";

/**
 * 前端调 House API 的 SDK。
 * 前端不持有任何密钥、不直连 MCP/Hub——一切请求只走 House API/BFF。
 */
export interface ApiClient {
  request<T extends z.ZodTypeAny>(
    path: string,
    dataSchema: T,
    init?: RequestInit
  ): Promise<ApiResponse<z.infer<T>>>;
}

export function createApiClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): ApiClient {
  return {
    async request<T extends z.ZodTypeAny>(
      path: string,
      dataSchema: T,
      init?: RequestInit
    ) {
      const res = await fetchImpl(new URL(path, baseUrl), {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
      const json: unknown = await res.json();
      // zod 对泛型 discriminatedUnion 的推断展不平，运行时已由 parse 校验，这里收窄回声明类型
      return apiResponseSchema(dataSchema).parse(json) as ApiResponse<z.infer<T>>;
    },
  };
}
