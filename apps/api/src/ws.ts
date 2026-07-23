import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { addClient } from "./broadcast.js";

const PING_INTERVAL_MS = 30_000;

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

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

  wss.on("connection", (ws: WebSocket) => {
    addClient(ws);
    ws.send(JSON.stringify({ type: "connected" }));

    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);

    ws.on("close", () => clearInterval(pingTimer));
  });

  return wss;
}
