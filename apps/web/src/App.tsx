import { useCallback, useState } from "react";
import { useScenes } from "./hooks/useScenes.js";
import { usePresence } from "./hooks/usePresence.js";
import { useEvents } from "./hooks/useEvents.js";
import { useHouseWs } from "./hooks/useHouseWs.js";
import { HouseMap } from "./components/HouseMap.js";
import { EventFeed } from "./components/EventFeed.js";
import { StatusBar } from "./components/StatusBar.js";
import type { WsMessage } from "@lamplight/api-client";
import type { Presence } from "@lamplight/contracts";
import type { HouseEventItem } from "./hooks/useEvents.js";

export function App() {
  const { scenes, loading } = useScenes();
  const { presence, updatePresence } = usePresence();
  const { events, prependEvent } = useEvents();
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "house_event" && msg.data) {
        prependEvent(msg.data as unknown as HouseEventItem);
      } else if (msg.type === "presence_update" && msg.data) {
        updatePresence(msg.data as unknown as Presence);
      }
    },
    [prependEvent, updatePresence],
  );

  const { status } = useHouseWs(handleWsMessage);

  if (loading) {
    return (
      <main className="app">
        <p className="loading">加载中…</p>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">lamplight · 留灯</h1>
        <StatusBar status={status} />
      </header>
      <div className="app-body">
        <section className="house-panel">
          <HouseMap
            scenes={scenes}
            presence={presence}
            selectedRoom={selectedRoom}
            onSelectRoom={setSelectedRoom}
          />
        </section>
        <aside className="feed-panel">
          <EventFeed events={events} />
        </aside>
      </div>
    </main>
  );
}
