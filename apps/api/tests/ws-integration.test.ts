import { describe, expect, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";

vi.mock("../src/services/gateway/index.js", () => {
  const mockGateway = {
    complete: vi.fn().mockResolvedValue({
      content: "大家好，我是小克~",
      usage: { input_tokens: 100, output_tokens: 50 },
      model_id: "claude-opus-4-6",
      provider_id: "anthropic",
      finish_reason: "end_turn",
    }),
    register: vi.fn(),
  };
  return {
    createGateway: () => mockGateway,
    getGateway: () => mockGateway,
    initGateway: () => mockGateway,
    invalidateProvider: vi.fn(),
    invalidateAllProviders: vi.fn(),
    GatewayService: vi.fn(() => mockGateway),
    AnthropicProvider: vi.fn(),
    OpenAIProvider: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };
});

const TOKEN = "test-token-ws";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

function collectEvents(ws: WebSocket, count: number, timeoutMs = 5000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    const timer = setTimeout(() => {
      ws.removeAllListeners("message");
      resolve(events);
    }, timeoutMs);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") return;
      events.push(msg);
      if (events.length >= count) {
        clearTimeout(timer);
        ws.removeAllListeners("message");
        resolve(events);
      }
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

describe("WebSocket integration", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const { app } = await import("../src/app.js");
    const { attachWebSocket } = await import("../src/ws.js");

    const { serve } = await import("@hono/node-server");
    server = serve({ fetch: app.fetch, port: 0 }) as Server;
    attachWebSocket(server, { pingIntervalMs: 60_000 });

    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });

    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    await db.run(sql`DELETE FROM messages`);
    await db.run(sql`DELETE FROM conversations`);
    await db.run(sql`DELETE FROM agent_profiles`);
    await db.run(sql`DELETE FROM agent_runtime_configs`);
    await db.run(sql`DELETE FROM ai_presence`);
    await db.run(sql`DELETE FROM scenes`);

    await db.insert(schema.scenes).values({
      scene_id: "room-living-room",
      display_name: "客厅",
      type: "room",
      default_turn_policy: {
        policy_id: "living-room-default",
        triggers: {
          on_user_message: "all_present",
          on_agent_message: {
            mention: true,
            random: false,
            cooldown_ms: 5000,
            max_consecutive: 2,
          },
        },
      },
    });

    await db.insert(schema.aiPresence).values([
      { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
    ]);

    await db.insert(schema.agentProfiles).values([
      {
        agent_id: "xiaoke",
        display_name: "小克",
        provider_id: "anthropic",
        model_id: "claude-opus-4-6",
        memory_scope: "xiaoke",
      },
    ]);

    await db.insert(schema.agentRuntimeConfigs).values([
      {
        agent_id: "xiaoke",
        random_reply_affinity: 1.0,
        max_response_tokens: 1024,
        temperature: 0.8,
        system_prompt_template: "You are 小克.",
      },
    ]);
  });

  it("rejects connections without valid token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong`);
    const closed = await new Promise<boolean>((resolve) => {
      ws.on("error", () => resolve(true));
      ws.on("close", () => resolve(true));
      ws.on("open", () => resolve(false));
    });
    expect(closed).toBe(true);
  });

  it("two clients receive full event lifecycle for a user message", async () => {
    const client1 = await connectWs(port);
    const client2 = await connectWs(port);

    try {
      const base = `http://127.0.0.1:${port}`;

      const createRes = await fetch(`${base}/conversations`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      expect(createRes.status).toBe(201);
      const { data: conv } = await createRes.json();

      const eventsPromise1 = collectEvents(client1, 4, 5000);
      const eventsPromise2 = collectEvents(client2, 4, 5000);

      const msgRes = await fetch(`${base}/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ content: "大家好！" }),
      });
      expect(msgRes.status).toBe(201);

      const events1 = await eventsPromise1;
      const events2 = await eventsPromise2;

      expect(events1.length).toBe(4);
      expect(events2.length).toBe(4);

      // Verify ordering: new_message(user) → agent_typing → new_message(AI) → agent_done
      const expectedOrder = ["new_message", "agent_typing", "new_message", "agent_done"];
      expect(events1.map((e: any) => e.type)).toEqual(expectedOrder);
      expect(events2.map((e: any) => e.type)).toEqual(expectedOrder);

      // Verify user message content
      expect(events1[0].data.content).toBe("大家好！");
      expect(events1[0].data.sender.type).toBe("user");

      // Verify agent_typing has correct agent
      expect(events1[1].data.agent_id).toBe("xiaoke");
      expect(events1[1].data.conversation_id).toBe(conv.id);

      // Verify AI message content
      expect(events1[2].data.content).toBe("大家好，我是小克~");
      expect(events1[2].data.sender.type).toBe("ai");
      expect(events1[2].data.sender.ai_id).toBe("xiaoke");

      // Verify agent_done
      expect(events1[3].data.agent_id).toBe("xiaoke");
      expect(events1[3].data.message_id).toBeTruthy();

      // Both clients see identical events
      expect(events1.map((e: any) => e.type)).toEqual(events2.map((e: any) => e.type));
      expect(events1[0].data.id).toBe(events2[0].data.id);
      expect(events1[2].data.id).toBe(events2[2].data.id);
    } finally {
      client1.close();
      client2.close();
    }
  });
});
