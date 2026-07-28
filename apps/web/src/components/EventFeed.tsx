import type { HouseEventItem } from "../hooks/useEvents.js";
import { formatRelativeTime } from "../utils/time.js";
import { getAgentMeta } from "../constants/agents.js";

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
        {events.map((ev) => {
          const aiId = ev.actor.ai_id;
          const meta = aiId ? getAgentMeta(aiId) : null;
          return (
            <div key={ev.id} className="event-item">
              {meta && <span className="event-avatar">{meta.emoji}</span>}
              <span className="event-desc">
                {ev.description ?? `${aiId ?? ev.actor.type}: ${ev.type}`}
              </span>
              <span className="event-time">{formatRelativeTime(ev.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
