import OpenAI from "openai";
import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
  GatewayError,
} from "@lamplight/contracts";

export class OpenAIProvider implements AIGateway {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(
    request: GatewayCompletionRequest,
  ): Promise<GatewayCompletionResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(
      (m) => ({
        role: m.role,
        content: m.content,
      }),
    );

    const params: OpenAI.ChatCompletionCreateParams = {
      model: request.model_id,
      messages,
    };

    if (request.max_tokens !== undefined) {
      params.max_tokens = request.max_tokens;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.stop_sequences?.length) {
      params.stop = request.stop_sequences;
    }

    let response: OpenAI.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(params);
    } catch (error) {
      throw this.mapError(error);
    }

    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? "",
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
      model_id: response.model,
      provider_id: "openai",
      finish_reason: this.mapFinishReason(choice?.finish_reason),
    };
  }

  private mapFinishReason(
    reason: string | null | undefined,
  ): "end_turn" | "max_tokens" | "stop_sequence" {
    switch (reason) {
      case "stop":
        return "end_turn";
      case "length":
        return "max_tokens";
      case "content_filter":
        return "end_turn";
      default:
        return "end_turn";
    }
  }

  private mapError(error: unknown): GatewayError {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        return {
          code: "rate_limited",
          message: error.message,
          provider_id: "openai",
          retryable: true,
        };
      }
      if (error.status === 408 || error.status === 504) {
        return {
          code: "timeout",
          message: error.message,
          provider_id: "openai",
          retryable: true,
        };
      }
      if (error.status === 400) {
        return {
          code: "invalid_request",
          message: error.message,
          provider_id: "openai",
          retryable: false,
        };
      }
      return {
        code: "provider_unavailable",
        message: error.message,
        provider_id: "openai",
        retryable: error.status >= 500,
      };
    }
    return {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      provider_id: "openai",
      retryable: false,
    };
  }
}
