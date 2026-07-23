export type WsMessageType = "house_event" | "presence_update" | "connected";

export interface WsMessage {
  type: WsMessageType;
  data?: Record<string, unknown>;
}

export type WsListener = (msg: WsMessage) => void;
export type WsStatusListener = (status: WsStatus) => void;
export type WsStatus = "connecting" | "connected" | "disconnected";

export interface HouseWsOptions {
  url: string;
  token: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class HouseWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private statusListeners = new Set<WsStatusListener>();
  private status: WsStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private closed = false;
  private readonly url: string;
  private readonly baseDelay: number;
  private readonly maxDelay: number;

  constructor(private readonly options: HouseWsOptions) {
    const wsUrl = new URL(options.url);
    wsUrl.searchParams.set("token", options.token);
    this.url = wsUrl.toString();
    this.baseDelay = options.reconnectDelayMs ?? 1000;
    this.maxDelay = options.maxReconnectDelayMs ?? 30000;
    this.reconnectDelay = this.baseDelay;
  }

  connect(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus("connecting");

    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      this.reconnectDelay = this.baseDelay;
    });

    ws.addEventListener("message", (event) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(String(event.data)) as WsMessage;
        if (msg.type === "connected") {
          this.setStatus("connected");
        }
        for (const listener of this.listeners) {
          listener(msg);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event will follow
    });

    this.ws = ws;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  onMessage(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: WsStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private setStatus(status: WsStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }
}
