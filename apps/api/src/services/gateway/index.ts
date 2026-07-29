export { AnthropicProvider } from "./anthropic-provider.js";
export { OpenAIProvider } from "./openai-provider.js";
export { GatewayService } from "./gateway-service.js";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { GatewayService } from "./gateway-service.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export interface GatewayConfig {
  anthropic_api_key?: string;
  anthropic_base_url?: string;
  openai_api_key?: string;
  openai_base_url?: string;
}

function getConfigPath(): string {
  if (process.env.ASSETS_DIR) return resolve(process.env.ASSETS_DIR, "../gateway-config.json");
  return resolve(import.meta.dirname ?? ".", "../../../data/gateway-config.json");
}

export function loadGatewayConfig(): GatewayConfig {
  try {
    return JSON.parse(readFileSync(getConfigPath(), "utf-8"));
  } catch {
    return {};
  }
}

export function saveGatewayConfig(config: GatewayConfig): void {
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function resolveConfig(): GatewayConfig {
  const file = loadGatewayConfig();
  return {
    anthropic_api_key: process.env.ANTHROPIC_API_KEY || file.anthropic_api_key,
    anthropic_base_url: process.env.ANTHROPIC_BASE_URL || file.anthropic_base_url,
    openai_api_key: process.env.OPENAI_API_KEY || file.openai_api_key,
    openai_base_url: process.env.OPENAI_BASE_URL || file.openai_base_url,
  };
}

let _gateway: GatewayService | null = null;

export function getGateway(): GatewayService {
  if (!_gateway) {
    _gateway = new GatewayService();
    applyConfig(_gateway);
  }
  return _gateway;
}

export function applyConfig(gateway: GatewayService, override?: GatewayConfig): void {
  const config = override ?? resolveConfig();

  if (config.anthropic_api_key) {
    gateway.register("anthropic", new AnthropicProvider(config.anthropic_api_key, config.anthropic_base_url));
  }
  if (config.openai_api_key) {
    gateway.register("openai", new OpenAIProvider(config.openai_api_key, config.openai_base_url));
  }
}

/** @deprecated Use getGateway() instead */
export function createGateway(): GatewayService {
  return getGateway();
}
