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
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  if (anthropicKey) {
    _gateway.register("anthropic", new AnthropicProvider(anthropicKey, anthropicBaseUrl));
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (openaiKey) {
    _gateway.register("openai", new OpenAIProvider(openaiKey, openaiBaseUrl));
  }

  if (anthropicKey || openaiKey) {
    provisionEnvProviders(db, anthropicKey, anthropicBaseUrl, openaiKey, openaiBaseUrl)
      .catch((err) => console.error("[gateway] env provider provisioning failed:", err));
  }

  return _gateway;
}

async function provisionEnvProviders(
  db: LibSQLDatabase<typeof schema>,
  anthropicKey: string | undefined,
  anthropicBaseUrl: string,
  openaiKey: string | undefined,
  openaiBaseUrl: string,
): Promise<void> {
  if (anthropicKey) {
    await ensureEnvProvider(db, "env-anthropic", "anthropic", anthropicBaseUrl, anthropicKey);
  }
  if (openaiKey) {
    await ensureEnvProvider(db, "env-openai", "openai", openaiBaseUrl, openaiKey);
  }
  await autoBindUnboundAgents(db);
}

async function ensureEnvProvider(
  db: LibSQLDatabase<typeof schema>,
  id: string,
  providerType: string,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const { encrypt: enc } = await import("./crypto.js");
  const existing = await db
    .select()
    .from(schema.apiProviders)
    .where(eq(schema.apiProviders.id, id))
    .limit(1);

  const now = new Date().toISOString();
  if (existing[0]) {
    await db.update(schema.apiProviders).set({
      base_url: baseUrl,
      api_key_encrypted: enc(apiKey),
      is_active: 1,
      updated_at: now,
    }).where(eq(schema.apiProviders.id, id));
    return;
  }

  await db.insert(schema.apiProviders).values({
    id,
    provider_type: providerType,
    display_name: `${providerType} (env)`,
    base_url: baseUrl,
    api_key_encrypted: enc(apiKey),
    is_active: 1,
    created_at: now,
    updated_at: now,
  });
}

async function autoBindUnboundAgents(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const agents = await db.select({ agent_id: schema.agentProfiles.agent_id }).from(schema.agentProfiles);
  const bindings = await db.select({ agent_id: schema.agentModelBindings.agent_id }).from(schema.agentModelBindings);
  const boundIds = new Set(bindings.map((b) => b.agent_id));

  const envProviders = await db.select().from(schema.apiProviders)
    .where(eq(schema.apiProviders.id, "env-anthropic"))
    .limit(1);
  const envOpenai = await db.select().from(schema.apiProviders)
    .where(eq(schema.apiProviders.id, "env-openai"))
    .limit(1);

  const hasAnthropic = envProviders.length > 0;
  const hasOpenai = envOpenai.length > 0;
  if (!hasAnthropic && !hasOpenai) return;

  const fallbackProvider = hasAnthropic
    ? { api_provider_id: "env-anthropic", provider_id: "anthropic", model_id: "claude-haiku-4-5" }
    : { api_provider_id: "env-openai", provider_id: "openai", model_id: "gpt-4o-mini" };

  const now = new Date().toISOString();
  for (const agent of agents) {
    if (boundIds.has(agent.agent_id)) continue;
    await db.insert(schema.agentModelBindings).values({
      id: `env-bind-${agent.agent_id}`,
      agent_id: agent.agent_id,
      ...fallbackProvider,
      created_at: now,
      updated_at: now,
    });
  }
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
