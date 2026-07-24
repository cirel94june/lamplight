import type { HouseEventItem } from "../hooks/useEvents.js";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  events: HouseEventItem[];
}

export function EventFeed({ events }: Props) {
  return (
    <div className="event-feed">
      <h3 className="event-feed-title">动态</h3>
      <div className="event-feed-list">
        {events.length === 0 && (
          <p className="event-feed-empty">还没有动态</p>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="event-item">
            <span className="event-time">{formatTime(ev.created_at)}</span>
            <span className="event-desc">
              {ev.description ?? `${ev.actor.ai_id ?? ev.actor.type}: ${ev.type}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
