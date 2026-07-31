import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
  GatewayError,
} from "@lamplight/contracts";

export type ProviderResolver = (apiProviderId: string) => Promise<AIGateway>;

export class GatewayService implements AIGateway {
  private providers = new Map<string, AIGateway>();
  private resolver: ProviderResolver | null;

  constructor(resolver?: ProviderResolver) {
    this.resolver = resolver ?? null;
  }

  register(providerId: string, provider: AIGateway): void {
    this.providers.set(providerId, provider);
  }

  async complete(
    request: GatewayCompletionRequest,
  ): Promise<GatewayCompletionResponse> {
    let provider: AIGateway | undefined;

    if (request.api_provider_id && this.resolver) {
      try {
        provider = await this.resolver(request.api_provider_id);
      } catch (err) {
        const error: GatewayError = {
          code: "provider_unavailable",
          message: err instanceof Error ? err.message : String(err),
          provider_id: request.provider_id,
          retryable: false,
        };
        throw error;
      }
    } else {
      provider = this.providers.get(request.provider_id);
    }

    if (!provider) {
      const error: GatewayError = {
        code: "provider_unavailable",
        message: `Unknown provider: ${request.provider_id}`,
        provider_id: request.provider_id,
        retryable: false,
      };
      throw error;
    }

    const maxRetries = request.retry_max ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await provider.complete(request);
        console.log(
          `[gateway] ${request.provider_id}/${request.model_id} ` +
            `in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
        );
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries && this.isRetryable(error)) {
          console.log(
            `[gateway] ${request.provider_id}/${request.model_id} failed, retrying (${attempt + 1}/${maxRetries})…`,
          );
          continue;
        }
        break;
      }
    }

    throw lastError;
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
