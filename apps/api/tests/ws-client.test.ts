import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { createServer } from "node:http";
import { app } from "../src/app.js";
import { attachWebSocket } from "../src/ws.js";
import { getClientCount } from "../src/broadcast.js";
import { HouseWsClient, type WsMessage } from "../../../packages/api-client/src/ws.js";
import { getRequestListener } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN = "test-token-123";
let server: Server;
let baseWsUrl: string;

beforeAll(async () => {
  process.env.OWNER_TOKEN = TOKEN;

  server = createServer(getRequestListener(app.fetch));
  attachWebSocket(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseWsUrl = `ws://127.0.0.1:${addr.port}/ws`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

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

function waitForStatus(client: HouseWsClient, status: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.getStatus() === status) return resolve();
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`status never reached ${status}, current: ${client.getStatus()}`));
    }, timeoutMs);
    const unsub = client.onStatus((s) => {
      if (s === status) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

describe("HouseWsClient lifecycle", () => {
  let client: HouseWsClient;

  afterEach(async () => {
    client?.close();
    await waitForClientCount(0).catch(() => {});
  });

  it("connects and receives connected status", async () => {
    client = new HouseWsClient({ url: baseWsUrl, token: TOKEN });
    client.connect();
    await waitForStatus(client, "connected");
    expect(client.getStatus()).toBe("connected");
  });

  it("duplicate connect() only creates one connection", async () => {
    const before = getClientCount();
    client = new HouseWsClient({ url: baseWsUrl, token: TOKEN });
    client.connect();
    client.connect();
    client.connect();

    await waitForStatus(client, "connected");
    expect(getClientCount()).toBe(before + 1);
  });

  it("duplicate connect() delivers each message only once", async () => {
    client = new HouseWsClient({ url: baseWsUrl, token: TOKEN });
    const messages: WsMessage[] = [];
    client.onMessage((msg) => messages.push(msg));

    client.connect();
    client.connect();

    await waitForStatus(client, "connected");
    await new Promise((r) => setTimeout(r, 100));

    const connectedMessages = messages.filter((m) => m.type === "connected");
    expect(connectedMessages).toHaveLength(1);
  });

  it("close() disconnects and server count drops", async () => {
    client = new HouseWsClient({ url: baseWsUrl, token: TOKEN });
    client.connect();
    await waitForStatus(client, "connected");

    client.close();
    expect(client.getStatus()).toBe("disconnected");
    await waitForClientCount(0);
  });

  it("does not reconnect after explicit close()", async () => {
    client = new HouseWsClient({
      url: baseWsUrl,
      token: TOKEN,
      reconnectDelayMs: 50,
    });
    client.connect();
    await waitForStatus(client, "connected");

    client.close();
    await new Promise((r) => setTimeout(r, 200));

    expect(client.getStatus()).toBe("disconnected");
  });

  it("exponential backoff with failed auth attempts", async () => {
    client = new HouseWsClient({
      url: baseWsUrl,
      token: "wrong-token",
      reconnectDelayMs: 10,
      maxReconnectDelayMs: 50,
    });

    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));

    client.connect();

    await new Promise((r) => setTimeout(r, 500));

    client.close();

    const connectingCount = statuses.filter((s) => s === "connecting").length;
    expect(connectingCount).toBeGreaterThan(2);
  });
});
