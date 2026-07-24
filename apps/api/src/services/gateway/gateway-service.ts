import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
  GatewayError,
} from "@lamplight/contracts";

export class GatewayService implements AIGateway {
  private providers = new Map<string, AIGateway>();

  register(providerId: string, provider: AIGateway): void {
    this.providers.set(providerId, provider);
  }

  async complete(
    request: GatewayCompletionRequest,
  ): Promise<GatewayCompletionResponse> {
    const provider = this.providers.get(request.provider_id);
    if (!provider) {
      const error: GatewayError = {
        code: "provider_unavailable",
        message: `Unknown provider: ${request.provider_id}`,
        provider_id: request.provider_id,
        retryable: false,
      };
      throw error;
    }

    try {
      const response = await provider.complete(request);
      console.log(
        `[gateway] ${request.provider_id}/${request.model_id} ` +
          `in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
      return response;
    } catch (error) {
      if (this.isRetryable(error)) {
        console.log(
          `[gateway] ${request.provider_id}/${request.model_id} failed, retrying…`,
        );
        try {
          const response = await provider.complete(request);
          console.log(
            `[gateway] ${request.provider_id}/${request.model_id} retry OK ` +
              `in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
          );
          return response;
        } catch (retryError) {
          console.error(
            `[gateway] ${request.provider_id}/${request.model_id} retry failed`,
          );
          throw retryError;
        }
      }
      throw error;
    }
  }

  private isRetryable(error: unknown): boolean {
    if (
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      "code" in error
    ) {
      return (error as GatewayError).retryable;
    }
    return false;
  }
}
