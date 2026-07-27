import { WebSocket } from "ws";

export type BroadcastMessage =
  | { type: "house_event"; data: Record<string, unknown> }
  | { type: "presence_update"; data: Record<string, unknown> }
  | { type: "new_message"; data: Record<string, unknown> }
  | { type: "agent_typing"; data: { conversation_id: string; agent_id: string } }
  | { type: "agent_done"; data: { conversation_id: string; agent_id: string; message_id: string } };

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
}

export function broadcast(msg: BroadcastMessage) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function getClientCount() {
  return clients.size;
}
