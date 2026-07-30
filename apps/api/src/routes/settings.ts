import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { encrypt, decrypt, invalidateProvider, invalidateAllProviders } from "../services/gateway/index.js";
import { AnthropicProvider } from "../services/gateway/anthropic-provider.js";
import { OpenAIProvider } from "../services/gateway/openai-provider.js";

const settings = new Hono();

function maskKey(encrypted: string): string {
  try {
    const plain = decrypt(encrypted);
    if (plain.length < 8) return "••••";
    return plain.slice(0, 4) + "••••" + plain.slice(-4);
  } catch {
    return "••••";
  }
}

// ── API Providers CRUD ──

settings.get("/providers", async (c) => {
  const rows = await db.select().from(schema.apiProviders);
  return c.json({
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      provider_type: r.provider_type,
      display_name: r.display_name,
      base_url: r.base_url,
      api_key_masked: maskKey(r.api_key_encrypted),
      is_active: !!r.is_active,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

settings.post("/providers", async (c) => {
  const body = await c.req.json<{
    provider_type: string;
    display_name: string;
    base_url: string;
    api_key: string;
  }>();

  if (!body.provider_type || !body.display_name || !body.base_url || !body.api_key) {
    return c.json({ ok: false, error: "provider_type, display_name, base_url, api_key are required" }, 400);
  }

  try {
    new URL(body.base_url);
  } catch {
    return c.json({ ok: false, error: "base_url is not a valid URL" }, 400);
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(schema.apiProviders).values({
    id,
    provider_type: body.provider_type,
    display_name: body.display_name,
    base_url: body.base_url,
    api_key_encrypted: encrypt(body.api_key),
    is_active: 1,
    created_at: now,
    updated_at: now,
  });

  return c.json({ ok: true, data: { id } }, 201);
});

settings.put("/providers/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    provider_type?: string;
    display_name?: string;
    base_url?: string;
    api_key?: string;
    is_active?: boolean;
  }>();

  const existing = await db.select().from(schema.apiProviders).where(eq(schema.apiProviders.id, id)).limit(1);
  if (!existing[0]) return c.json({ ok: false, error: "not found" }, 404);

  if (body.base_url) {
    try {
      new URL(body.base_url);
    } catch {
      return c.json({ ok: false, error: "base_url is not a valid URL" }, 400);
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.provider_type !== undefined) updates.provider_type = body.provider_type;
  if (body.display_name !== undefined) updates.display_name = body.display_name;
  if (body.base_url !== undefined) updates.base_url = body.base_url;
  if (body.api_key !== undefined) updates.api_key_encrypted = encrypt(body.api_key);
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0;

  await db.update(schema.apiProviders).set(updates).where(eq(schema.apiProviders.id, id));
  invalidateProvider(id);

  return c.json({ ok: true });
});

settings.delete("/providers/:id", async (c) => {
  const id = c.req.param("id");

  const agents = await db
    .select({ agent_id: schema.agentProfiles.agent_id })
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.api_provider_id, id));

  if (agents.length > 0) {
    return c.json({
      ok: false,
      error: `Provider is in use by agents: ${agents.map((a) => a.agent_id).join(", ")}`,
    }, 409);
  }

  await db.delete(schema.apiProviders).where(eq(schema.apiProviders.id, id));
  invalidateProvider(id);

  return c.json({ ok: true });
});

settings.post("/providers/:id/test", async (c) => {
  const id = c.req.param("id");

  const rows = await db.select().from(schema.apiProviders).where(eq(schema.apiProviders.id, id)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ ok: false, error: "not found" }, 404);

  const apiKey = decrypt(row.api_key_encrypted);

  try {
    let provider;
    switch (row.provider_type) {
      case "anthropic":
        provider = new AnthropicProvider(apiKey, row.base_url);
        break;
      default:
        provider = new OpenAIProvider(apiKey, row.base_url);
        break;
    }

    await provider.complete({
      provider_id: row.provider_type,
      model_id: row.provider_type === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini",
      api_provider_id: id,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
    });

    return c.json({ ok: true, data: { status: "connected" } });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? "connection failed" }, 502);
  }
});

// ── Agent Model Config ──

settings.get("/agents", async (c) => {
  const profiles = await db.select({
    agent_id: schema.agentProfiles.agent_id,
    display_name: schema.agentProfiles.display_name,
    provider_id: schema.agentProfiles.provider_id,
    model_id: schema.agentProfiles.model_id,
    api_provider_id: schema.agentProfiles.api_provider_id,
  }).from(schema.agentProfiles);

  return c.json({ ok: true, data: profiles });
});

settings.put("/agents/:agent_id/model-config", async (c) => {
  const agentId = c.req.param("agent_id");
  const body = await c.req.json<{
    provider_id: string;
    model_id: string;
    api_provider_id: string;
  }>();

  if (!body.provider_id || !body.model_id || !body.api_provider_id) {
    return c.json({ ok: false, error: "provider_id, model_id, api_provider_id are required" }, 400);
  }

  const existing = await db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.agent_id, agentId))
    .limit(1);
  if (!existing[0]) return c.json({ ok: false, error: "agent not found" }, 404);

  const providerExists = await db
    .select({ id: schema.apiProviders.id })
    .from(schema.apiProviders)
    .where(eq(schema.apiProviders.id, body.api_provider_id))
    .limit(1);
  if (!providerExists[0]) return c.json({ ok: false, error: "api_provider_id not found" }, 400);

  await db
    .update(schema.agentProfiles)
    .set({
      provider_id: body.provider_id,
      model_id: body.model_id,
      api_provider_id: body.api_provider_id,
    })
    .where(eq(schema.agentProfiles.agent_id, agentId));

  return c.json({ ok: true });
});

export { settings };
