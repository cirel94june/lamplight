export { AnthropicProvider } from "./anthropic-provider.js";
export { OpenAIProvider } from "./openai-provider.js";
export { GatewayService } from "./gateway-service.js";
export { encrypt, decrypt } from "./crypto.js";

import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { GatewayService } from "./gateway-service.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { decrypt } from "./crypto.js";
import type { AIGateway } from "@lamplight/contracts";
import * as schema from "../../db/schema.js";

export type ProviderResolver = (apiProviderId: string) => Promise<AIGateway>;

function createProviderInstance(providerType: string, apiKey: string, baseURL: string): AIGateway {
  switch (providerType) {
    case "anthropic":
      return new AnthropicProvider(apiKey, baseURL);
    case "openai":
    case "deepseek":
      return new OpenAIProvider(apiKey, baseURL);
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

export function createResolver(db: LibSQLDatabase<typeof schema>): ProviderResolver {
  const cache = new Map<string, AIGateway>();

  const resolver: ProviderResolver & { invalidate: (id: string) => void; invalidateAll: () => void } = Object.assign(
    async (apiProviderId: string): Promise<AIGateway> => {
      const cached = cache.get(apiProviderId);
      if (cached) return cached;

      const rows = await db
        .select()
        .from(schema.apiProviders)
        .where(eq(schema.apiProviders.id, apiProviderId))
        .limit(1);

      const row = rows[0];
      if (!row) throw new Error(`API provider not found: ${apiProviderId}`);
      if (!row.is_active) throw new Error(`API provider is inactive: ${row.display_name}`);

      const apiKey = decrypt(row.api_key_encrypted);
      const provider = createProviderInstance(row.provider_type, apiKey, row.base_url);
      cache.set(apiProviderId, provider);
      return provider;
    },
    {
      invalidate: (id: string) => cache.delete(id),
      invalidateAll: () => cache.clear(),
    },
  );

  return resolver;
}

let _gateway: GatewayService | null = null;
let _resolver: (ProviderResolver & { invalidate: (id: string) => void; invalidateAll: () => void }) | null = null;

export function initGateway(db: LibSQLDatabase<typeof schema>): GatewayService {
  _resolver = createResolver(db) as typeof _resolver;
  _gateway = new GatewayService(_resolver!);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    _gateway.register("anthropic", new AnthropicProvider(anthropicKey, "https://api.anthropic.com"));
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    _gateway.register("openai", new OpenAIProvider(openaiKey, "https://api.openai.com/v1"));
  }

  return _gateway;
}

export function getGateway(): GatewayService {
  if (!_gateway) throw new Error("Gateway not initialized — call initGateway(db) first");
  return _gateway;
}

export function invalidateProvider(apiProviderId: string): void {
  _resolver?.invalidate(apiProviderId);
}

export function invalidateAllProviders(): void {
  _resolver?.invalidateAll();
}

/** @deprecated Use getGateway() instead */
export function createGateway(): GatewayService {
  return getGateway();
}
