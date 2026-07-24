import Anthropic from "@anthropic-ai/sdk";
import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
  GatewayError,
} from "@lamplight/contracts";

export class AnthropicProvider implements AIGateway {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
  }

  async complete(
    request: GatewayCompletionRequest,
  ): Promise<GatewayCompletionResponse> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter(
      (m) => m.role !== "system",
    );

    const params: Anthropic.MessageCreateParams = {
      model: request.model_id,
      max_tokens: request.max_tokens ?? 1024,
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    };

    if (systemMessages.length > 0) {
      params.system = systemMessages.map((m) => m.content).join("\n\n");
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.stop_sequences?.length) {
      params.stop_sequences = request.stop_sequences;
    }

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(params);
    } catch (error) {
      throw this.mapError(error);
    }

    const textBlock = response.content.find((b) => b.type === "text");

    return {
      content: textBlock?.text ?? "",
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      model_id: response.model,
      provider_id: "anthropic",
      finish_reason: this.mapStopReason(response.stop_reason),
    };
  }

  private mapStopReason(
    reason: string | null,
  ): "end_turn" | "max_tokens" | "stop_sequence" {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }

  private mapError(error: unknown): GatewayError {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return {
        code: "timeout",
        message: error.message,
        provider_id: "anthropic",
        retryable: true,
      };
    }
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        return {
          code: "rate_limited",
          message: error.message,
          provider_id: "anthropic",
          retryable: true,
        };
      }
      if (error.status === 408 || error.status === 504) {
        return {
          code: "timeout",
          message: error.message,
          provider_id: "anthropic",
          retryable: true,
        };
      }
      if (error.status === 400) {
        return {
          code: "invalid_request",
          message: error.message,
          provider_id: "anthropic",
          retryable: false,
        };
      }
      return {
        code: "provider_unavailable",
        message: error.message,
        provider_id: "anthropic",
        retryable: error.status >= 500,
      };
    }
    return {
      code: "unknown",
      message: error instanceof Error ? error.message : String(error),
      provider_id: "anthropic",
      retryable: false,
    };
  }
}
