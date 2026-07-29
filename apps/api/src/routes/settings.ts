import { Hono } from "hono";
import {
  getGateway,
  loadGatewayConfig,
  saveGatewayConfig,
  applyConfig,
  type GatewayConfig,
} from "../services/gateway/index.js";

const settings = new Hono();

function maskKey(key?: string): string {
  if (!key || key.length < 8) return key ? "••••" : "";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

settings.get("/gateway", (c) => {
  const config = loadGatewayConfig();
  return c.json({
    ok: true,
    data: {
      anthropic_api_key: maskKey(config.anthropic_api_key),
      anthropic_base_url: config.anthropic_base_url ?? "",
      openai_api_key: maskKey(config.openai_api_key),
      openai_base_url: config.openai_base_url ?? "",
      anthropic_env: !!process.env.ANTHROPIC_API_KEY,
      openai_env: !!process.env.OPENAI_API_KEY,
    },
  });
});

settings.put("/gateway", async (c) => {
  const body = await c.req.json<Partial<GatewayConfig>>();

  const existing = loadGatewayConfig();
  const updated: GatewayConfig = { ...existing };

  if (body.anthropic_api_key !== undefined) {
    updated.anthropic_api_key = body.anthropic_api_key || undefined;
  }
  if (body.anthropic_base_url !== undefined) {
    updated.anthropic_base_url = body.anthropic_base_url || undefined;
  }
  if (body.openai_api_key !== undefined) {
    updated.openai_api_key = body.openai_api_key || undefined;
  }
  if (body.openai_base_url !== undefined) {
    updated.openai_base_url = body.openai_base_url || undefined;
  }

  saveGatewayConfig(updated);
  applyConfig(getGateway());

  return c.json({
    ok: true,
    data: {
      anthropic_api_key: maskKey(updated.anthropic_api_key),
      anthropic_base_url: updated.anthropic_base_url ?? "",
      openai_api_key: maskKey(updated.openai_api_key),
      openai_base_url: updated.openai_base_url ?? "",
    },
  });
});

export { settings };
