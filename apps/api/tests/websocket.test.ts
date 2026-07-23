import { describe, expect, it, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { app } from "../src/app.js";
import { attachWebSocket } from "../src/ws.js";
import { getClientCount } from "../src/broadcast.js";
import { db, schema } from "../src/db/index.js";
import { getRequestListener } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "test-token-123";
let server: Server;
let baseUrl: string;
let wsUrl: string;

beforeAll(async () => {
  process.env.OWNER_TOKEN = TOKEN;

  server = createServer(getRequestListener(app.fetch));
  attachWebSocket(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      wsUrl = `ws://127.0.0.1:${addr.port}/ws?token=${TOKEN}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connectWs(url?: string): Promise<{ ws: WebSocket; firstMessage: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url ?? wsUrl);
    ws.once("message", (data) => {
      resolve({ ws, firstMessage: JSON.parse(data.toString()) });
    });
    ws.on("error", reject);
  });
}

function connectWsRaw(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClientCount(target: number, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (getClientCount() === target) return resolve();
      if (Date.now() > deadline) return reject(new Error(`client count ${getClientCount()} != ${target}`));
      setTimeout(check, 10);
    };
    check();
  });
}

describe("WebSocket connection", () => {
  it("connects with valid token and receives connected message", async () => {
    const { ws, firstMessage } = await connectWs();
    expect(firstMessage.type).toBe("connected");
    ws.close();
    await new Promise((r) => ws.on("close", r));
  });

  it("rejects connection without token", async () => {
    const addr = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${addr.port}/ws`;
    await expect(connectWsRaw(url)).rejects.toThrow();
  });

  it("rejects connection with wrong token", async () => {
    const addr = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${addr.port}/ws?token=wrong`;
    await expect(connectWsRaw(url)).rejects.toThrow();
  });

  it("rejects upgrade on non-/ws path", async () => {
    const addr = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${addr.port}/other?token=${TOKEN}`;
    await expect(connectWsRaw(url)).rejects.toThrow();
  });

  it("tracks client count", async () => {
    const before = getClientCount();
    const { ws } = await connectWs();
    expect(getClientCount()).toBe(before + 1);
    ws.close();
    await new Promise((r) => ws.on("close", r));
    await waitForClientCount(before);
    expect(getClientCount()).toBe(before);
  });
});

describe("WebSocket broadcasts", () => {
  let ws: WebSocket;

  beforeEach(async () => {
    await db.delete(schema.houseEvents);
    await db.delete(schema.aiPresence);
    const conn = await connectWs();
    ws = conn.ws;
  });

  afterEach(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  it("broadcasts house_event when POST /house-events succeeds", async () => {
    const msgPromise = waitForMessage(ws);

    const res = await fetch(`${baseUrl}/house-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "evt-ws-test-1",
        type: "ai_moved",
        actor: { type: "ai", ai_id: "xiaoke" },
        scene_id: "room-living-room",
        payload: { from: "room-study", to: "room-living-room" },
        description: "小克走进了客厅",
        created_at: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(201);

    const msg = await msgPromise;
    expect(msg.type).toBe("house_event");
    const data = msg.data as Record<string, unknown>;
    expect(data.id).toBe("evt-ws-test-1");
    expect(data.type).toBe("ai_moved");
    expect((data.context as Record<string, unknown>).set_by).toBe("server");
    expect(data.conversation_kind).toBe("house_chat");
  });

  it("broadcasts presence_update when PUT /presence/:ai_id succeeds", async () => {
    const msgPromise = waitForMessage(ws);

    const res = await fetch(`${baseUrl}/presence/xiaoke`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scene_id: "room-living-room",
        state: "active",
        updated_at: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(200);

    const msg = await msgPromise;
    expect(msg.type).toBe("presence_update");
    const data = msg.data as Record<string, unknown>;
    expect(data.ai_id).toBe("xiaoke");
    expect(data.state).toBe("active");
  });

  it("two connected clients both receive broadcast", async () => {
    const { ws: ws2 } = await connectWs();

    const msg1Promise = waitForMessage(ws);
    const msg2Promise = waitForMessage(ws2);

    await fetch(`${baseUrl}/house-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "evt-ws-multi",
        type: "ai_spoke",
        actor: { type: "ai", ai_id: "lucien" },
        payload: { text: "hello" },
        created_at: new Date().toISOString(),
      }),
    });

    const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);
    expect(msg1.type).toBe("house_event");
    expect(msg2.type).toBe("house_event");
    expect((msg1.data as Record<string, unknown>).id).toBe("evt-ws-multi");
    expect((msg2.data as Record<string, unknown>).id).toBe("evt-ws-multi");

    ws2.close();
  });
});

describe("WebSocket heartbeat", () => {
  let heartbeatServer: Server;
  let heartbeatWsUrl: string;

  beforeAll(async () => {
    heartbeatServer = createServer(getRequestListener(app.fetch));
    attachWebSocket(heartbeatServer, { pingIntervalMs: 50 });

    await new Promise<void>((resolve) => {
      heartbeatServer.listen(0, "127.0.0.1", () => {
        const addr = heartbeatServer.address() as AddressInfo;
        heartbeatWsUrl = `ws://127.0.0.1:${addr.port}/ws?token=${TOKEN}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => heartbeatServer.close(() => r()));
  });

  it("terminates client that does not respond to pong", async () => {
    const ws = new WebSocket(heartbeatWsUrl, { autoPong: false });
    await new Promise<void>((resolve) => {
      ws.once("message", () => resolve());
    });
    expect(getClientCount()).toBeGreaterThanOrEqual(1);

    const closed = new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
    });

    const code = await closed;
    expect(code).toBe(1006);
  });

  it("does not terminate client that responds to pong normally", async () => {
    const ws = new WebSocket(heartbeatWsUrl);
    await new Promise<void>((resolve) => {
      ws.once("message", () => resolve());
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await new Promise((r) => ws.on("close", r));
  });
});
