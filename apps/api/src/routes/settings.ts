import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { encrypt, decrypt, invalidateProvider, invalidateAllProviders } from "../services/gateway/index.js";
import { AnthropicProvider } from "../services/gateway/anthropic-provider.js";
import { OpenAIProvider } from "../services/gateway/openai-provider.js";

const settings = new Hono();

const SUPPORTED_PROVIDER_TYPES = ["anthropic", "openai", "deepseek"] as const;
type ProviderType = (typeof SUPPORTED_PROVIDER_TYPES)[number];

function isSupportedProviderType(t: string): t is ProviderType {
  return (SUPPORTED_PROVIDER_TYPES as readonly string[]).includes(t);
}

function maskKey(encrypted: string): string {
  try {
    const plain = decrypt(encrypted);
    if (plain.length < 8) return "••••";
    return plain.slice(0, 4) + "••••" + plain.slice(-4);
  } catch {
    return "••••";
  }
}

function isValidUrl(s: string): boolean {
  if (!s) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
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
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Request body must be a JSON object" }, 400);
  }

  if (!body.provider_type || !body.display_name || !body.base_url || !body.api_key) {
    return c.json({ ok: false, error: "provider_type, display_name, base_url, api_key are required" }, 400);
  }

  if (!isSupportedProviderType(body.provider_type)) {
    return c.json({ ok: false, error: `Unsupported provider_type: ${body.provider_type}. Supported: ${SUPPORTED_PROVIDER_TYPES.join(", ")}` }, 400);
  }

  if (!isValidUrl(body.base_url)) {
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
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Request body must be a JSON object" }, 400);
  }

  const existing = await db.select().from(schema.apiProviders).where(eq(schema.apiProviders.id, id)).limit(1);
  if (!existing[0]) return c.json({ ok: false, error: "not found" }, 404);

  if (body.provider_type !== undefined && !isSupportedProviderType(body.provider_type)) {
    return c.json({ ok: false, error: `Unsupported provider_type: ${body.provider_type}. Supported: ${SUPPORTED_PROVIDER_TYPES.join(", ")}` }, 400);
  }

  if (body.provider_type !== undefined && body.provider_type !== existing[0].provider_type) {
    const bindings = await db
      .select({ agent_id: schema.agentModelBindings.agent_id })
      .from(schema.agentModelBindings)
      .where(eq(schema.agentModelBindings.api_provider_id, id));
    if (bindings.length > 0) {
      return c.json({
        ok: false,
        error: `Cannot change provider_type while bound to agents: ${bindings.map((b) => b.agent_id).join(", ")}. Remove bindings first.`,
      }, 409);
    }
  }

  if (body.base_url !== undefined) {
    if (!isValidUrl(body.base_url)) {
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

  const bindings = await db
    .select({ agent_id: schema.agentModelBindings.agent_id })
    .from(schema.agentModelBindings)
    .where(eq(schema.agentModelBindings.api_provider_id, id));

  if (bindings.length > 0) {
    return c.json({
      ok: false,
      error: `Provider is in use by agents: ${bindings.map((b) => b.agent_id).join(", ")}`,
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

    const testModel = c.req.query("model");
    const modelId = testModel || (row.provider_type === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini");

    await provider.complete({
      provider_id: row.provider_type,
      model_id: modelId,
      api_provider_id: id,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
    });

    return c.json({ ok: true, data: { status: "connected" } });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message ?? "connection failed" }, 502);
  }
});

// ── Agent Model Bindings ──

settings.get("/agents", async (c) => {
  const profiles = await db.select().from(schema.agentProfiles);
  const bindings = await db.select().from(schema.agentModelBindings);

  const bindingMap = new Map(bindings.map((b) => [b.agent_id, b]));

  return c.json({
    ok: true,
    data: profiles.map((p) => ({
      agent_id: p.agent_id,
      display_name: p.display_name,
      binding: bindingMap.get(p.agent_id)
        ? {
            id: bindingMap.get(p.agent_id)!.id,
            api_provider_id: bindingMap.get(p.agent_id)!.api_provider_id,
            provider_id: bindingMap.get(p.agent_id)!.provider_id,
            model_id: bindingMap.get(p.agent_id)!.model_id,
            fault_state: bindingMap.get(p.agent_id)!.fault_state,
          }
        : null,
    })),
  });
});

settings.put("/agents/:agent_id/model-config", async (c) => {
  const agentId = c.req.param("agent_id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Request body must be a JSON object" }, 400);
  }

  if (!body.provider_id || !body.model_id || !body.api_provider_id) {
    return c.json({ ok: false, error: "provider_id, model_id, api_provider_id are required" }, 400);
  }

  if (!isSupportedProviderType(body.provider_id)) {
    return c.json({ ok: false, error: `Unsupported provider_id: ${body.provider_id}. Supported: ${SUPPORTED_PROVIDER_TYPES.join(", ")}` }, 400);
  }

  const existingAgent = await db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.agent_id, agentId))
    .limit(1);
  if (!existingAgent[0]) return c.json({ ok: false, error: "agent not found" }, 404);

  const providerRow = await db
    .select()
    .from(schema.apiProviders)
    .where(eq(schema.apiProviders.id, body.api_provider_id))
    .limit(1);
  if (!providerRow[0]) return c.json({ ok: false, error: "api_provider_id not found" }, 400);

  if (providerRow[0].provider_type !== body.provider_id) {
    return c.json({
      ok: false,
      error: `provider_id "${body.provider_id}" does not match provider's type "${providerRow[0].provider_type}"`,
    }, 400);
  }

  const now = new Date().toISOString();
  const existingBinding = await db
    .select()
    .from(schema.agentModelBindings)
    .where(eq(schema.agentModelBindings.agent_id, agentId))
    .limit(1);

  if (existingBinding[0]) {
    await db
      .update(schema.agentModelBindings)
      .set({
        api_provider_id: body.api_provider_id,
        provider_id: body.provider_id,
        model_id: body.model_id,
        fault_state: "ok",
        fault_since: null,
        total_errors: 0,
        updated_at: now,
      })
      .where(eq(schema.agentModelBindings.agent_id, agentId));
  } else {
    await db.insert(schema.agentModelBindings).values({
      id: randomUUID(),
      agent_id: agentId,
      api_provider_id: body.api_provider_id,
      provider_id: body.provider_id,
      model_id: body.model_id,
      created_at: now,
      updated_at: now,
    });
  }

  return c.json({ ok: true });
});

export { settings };
