import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { addClient } from "./broadcast.js";

const PING_INTERVAL_MS = 30_000;

export interface AttachWebSocketOptions {
  pingIntervalMs?: number;
}

export function attachWebSocket(server: Server, options?: AttachWebSocketOptions) {
  const wss = new WebSocketServer({ noServer: true });
  const interval = options?.pingIntervalMs ?? PING_INTERVAL_MS;

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const expected = process.env.OWNER_TOKEN;
    if (!expected || token !== expected) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket & { isAlive?: boolean }) => {
    ws.isAlive = true;
    addClient(ws);
    ws.send(JSON.stringify({ type: "connected" }));

    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
  });

  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as WebSocket & { isAlive?: boolean };
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, interval);

  wss.on("close", () => clearInterval(heartbeatTimer));

  return wss;
}
