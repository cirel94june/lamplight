import { z } from "zod";

/**
 * AI Gateway 契约：provider 路由层的输入/输出形状。
 * Gateway 不知道 agent_id，只看 provider_id + model_id（架构 §2 红线）。
 */

export const gatewayMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type GatewayMessage = z.infer<typeof gatewayMessageSchema>;

export const gatewayCompletionRequestSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  messages: z.array(gatewayMessageSchema).min(1),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stop_sequences: z.array(z.string()).optional(),
});
export type GatewayCompletionRequest = z.infer<typeof gatewayCompletionRequestSchema>;

export const gatewayUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type GatewayUsage = z.infer<typeof gatewayUsageSchema>;

export const gatewayCompletionResponseSchema = z.object({
  content: z.string(),
  usage: gatewayUsageSchema,
  model_id: z.string().min(1),
  provider_id: z.string().min(1),
  finish_reason: z.enum(["end_turn", "max_tokens", "stop_sequence"]),
});
export type GatewayCompletionResponse = z.infer<typeof gatewayCompletionResponseSchema>;

export const gatewayErrorSchema = z.object({
  code: z.enum(["provider_unavailable", "rate_limited", "timeout", "invalid_request", "unknown"]),
  message: z.string(),
  provider_id: z.string().min(1).optional(),
  retryable: z.boolean(),
});
export type GatewayError = z.infer<typeof gatewayErrorSchema>;

/**
 * AIGateway 接口：业务代码通过此接口调用模型，不直连 provider SDK。
 */
export interface AIGateway {
  complete(request: GatewayCompletionRequest): Promise<GatewayCompletionResponse>;
}
