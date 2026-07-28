import { useCallback, useMemo, useState } from "react";
import { useScenes } from "./hooks/useScenes.js";
import { usePresence } from "./hooks/usePresence.js";
import { useEvents } from "./hooks/useEvents.js";
import { useHouseWs } from "./hooks/useHouseWs.js";
import { useConversation } from "./hooks/useConversation.js";
import { useChat } from "./hooks/useChat.js";
import { useAssets } from "./hooks/useAssets.js";
import { HouseMap } from "./components/HouseMap.js";
import { EventFeed } from "./components/EventFeed.js";
import { ChatPanel } from "./components/chat/ChatPanel.js";
import { SettingsPanel } from "./components/settings/SettingsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import type { WsMessage } from "@lamplight/api-client";
import type { Presence } from "@lamplight/contracts";
import type { HouseEventItem } from "./hooks/useEvents.js";

export function App() {
  const { scenes, loading } = useScenes();
  const { presence, updatePresence } = usePresence();
  const { events, prependEvent } = useEvents();
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { conversationId, loading: convLoading } = useConversation(selectedRoom);
  const chat = useChat(conversationId);
  const { getAvatarUrl, getRoomImageUrl, uploadAsset, deleteAsset } = useAssets();

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "house_event" && msg.data) {
        prependEvent(msg.data as unknown as HouseEventItem);
      } else if (msg.type === "presence_update" && msg.data) {
        updatePresence(msg.data as unknown as Presence);
      } else if (msg.type === "new_message" && msg.data) {
        chat.handleNewMessage(msg.data as Record<string, unknown>);
      } else if (msg.type === "agent_typing" && msg.data) {
        chat.handleTyping(msg.data as Record<string, unknown>);
      } else if (msg.type === "agent_done" && msg.data) {
        chat.handleDone(msg.data as Record<string, unknown>);
      }
    },
    [prependEvent, updatePresence, chat.handleNewMessage, chat.handleTyping, chat.handleDone],
  );

  const { status } = useHouseWs(handleWsMessage);

  const roomName = useMemo(() => {
    if (!selectedRoom) return "";
    const scene = scenes.find((s) => s.scene_id === selectedRoom);
    return scene?.display_name ?? selectedRoom;
  }, [selectedRoom, scenes]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="settings-gear"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
          >
            ⚙
          </button>
          <StatusBar status={status} />
        </div>
      </header>
      <div className="app-body">
        <section className="house-panel">
          <HouseMap
            scenes={scenes}
            presence={presence}
            selectedRoom={selectedRoom}
            onSelectRoom={setSelectedRoom}
            getAvatarUrl={getAvatarUrl}
            getRoomImageUrl={getRoomImageUrl}
          />
        </section>
        {selectedRoom ? (
          <aside className="chat-aside">
            <ChatPanel
              roomName={roomName}
              messages={chat.messages}
              typingAgents={chat.typingAgents}
              hasMore={chat.hasMore}
              loading={chat.loading || convLoading}
              onSend={chat.sendMessage}
              onLoadMore={chat.loadMore}
              onClose={() => setSelectedRoom(null)}
              getAvatarUrl={getAvatarUrl}
            />
          </aside>
        ) : (
          <aside className="feed-panel">
            <EventFeed events={events} />
          </aside>
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        scenes={scenes}
        getAvatarUrl={getAvatarUrl}
        getRoomImageUrl={getRoomImageUrl}
        uploadAsset={uploadAsset}
        deleteAsset={deleteAsset}
      />
    </main>
  );
}
