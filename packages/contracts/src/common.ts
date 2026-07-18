import { z } from "zod";

/** API 错误体。 */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * ApiResponse 通用包裹：所有 House API 响应都长这样。
 * 用法：apiResponseSchema(presenceSchema).parse(json)
 */
export const apiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: apiErrorSchema }),
  ]);
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/** ApiRequest 通用包裹：带可选幂等/追踪 ID 的请求体。 */
export const apiRequestSchema = <T extends z.ZodTypeAny>(body: T) =>
  z.object({
    request_id: z.string().optional(),
    body,
  });
export type ApiRequest<T> = { request_id?: string; body: T };
