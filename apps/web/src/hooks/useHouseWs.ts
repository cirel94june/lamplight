import { useEffect, useRef, useState } from "react";
import { HouseWsClient, type WsMessage, type WsStatus } from "@lamplight/api-client";

export function useHouseWs(onMessage: (msg: WsMessage) => void) {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const clientRef = useRef<HouseWsClient | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const client = new HouseWsClient({
      url: wsUrl,
      token: "",
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 30000,
    });

    clientRef.current = client;

    client.onStatus(setStatus);
    client.onMessage((msg) => onMessageRef.current(msg));
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, []);

  return { status };
}
