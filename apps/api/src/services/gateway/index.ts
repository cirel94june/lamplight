export { AnthropicProvider } from "./anthropic-provider.js";
export { OpenAIProvider } from "./openai-provider.js";
export { GatewayService } from "./gateway-service.js";

import { GatewayService } from "./gateway-service.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export function createGateway(): GatewayService {
  const gateway = new GatewayService();

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    gateway.register("anthropic", new AnthropicProvider(anthropicKey));
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    gateway.register("openai", new OpenAIProvider(openaiKey));
  }

  return gateway;
}
