import type { SceneDefinition, Presence } from "@lamplight/contracts";

const AI_COLORS: Record<string, string> = {
  xiaoke: "#6EC6FF",
  lucien: "#CE93D8",
  jasper: "#FFB74D",
};

const AI_LABELS: Record<string, string> = {
  xiaoke: "克",
  lucien: "L",
  jasper: "J",
};

interface RoomLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GRID: Record<string, RoomLayout> = {
  "room-living-room":     { x: 0,   y: 0,   w: 280, h: 180 },
  "room-study":           { x: 290, y: 0,   w: 180, h: 180 },
  "room-ceci-bedroom":    { x: 0,   y: 190, w: 180, h: 160 },
  "room-xiaoke-bedroom":  { x: 190, y: 190, w: 140, h: 160 },
  "room-lucien-bedroom":  { x: 340, y: 190, w: 130, h: 160 },
  "room-jasper-bedroom":  { x: 0,   y: 360, w: 180, h: 140 },
  "room-counseling":      { x: 190, y: 360, w: 280, h: 140 },
};

interface Props {
  scenes: SceneDefinition[];
  presence: Presence[];
  selectedRoom: string | null;
  onSelectRoom: (id: string | null) => void;
}

export function HouseMap({ scenes, presence, selectedRoom, onSelectRoom }: Props) {
  const getAIsInRoom = (sceneId: string) =>
    presence.filter((p) => p.scene_id === sceneId);

  return (
    <svg viewBox="-10 -10 500 520" style={{ width: "100%", maxWidth: 520 }}>
      {scenes.map((scene) => {
        const layout = GRID[scene.scene_id];
        if (!layout) return null;
        const ais = getAIsInRoom(scene.scene_id);
        const isSelected = selectedRoom === scene.scene_id;

        return (
          <g
            key={scene.scene_id}
            onClick={() => onSelectRoom(isSelected ? null : scene.scene_id)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={layout.x}
              y={layout.y}
              width={layout.w}
              height={layout.h}
              rx={6}
              fill={isSelected ? "var(--room-selected)" : "var(--room-bg)"}
              stroke={isSelected ? "var(--room-border-active)" : "var(--room-border)"}
              strokeWidth={isSelected ? 2 : 1}
            />
            <text
              x={layout.x + 10}
              y={layout.y + 22}
              fontSize={13}
              fill="var(--text-primary)"
              fontWeight={500}
            >
              {scene.display_name}
            </text>

            {ais.map((ai, i) => {
              const cx = layout.x + 20 + i * 30;
              const cy = layout.y + layout.h - 28;
              const color = AI_COLORS[ai.ai_id] ?? "#90A4AE";
              const label = AI_LABELS[ai.ai_id] ?? ai.ai_id.charAt(0).toUpperCase();
              const isActive = ai.state === "active";
              const isIdle = ai.state === "idle";

              return (
                <g key={ai.ai_id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={12}
                    fill={color}
                    opacity={isActive ? 1 : 0.45}
                  />
                  <text
                    x={cx}
                    y={cy + 4}
                    fontSize={11}
                    fill="#fff"
                    textAnchor="middle"
                    fontWeight={600}
                  >
                    {label}
                  </text>
                  {isIdle && (
                    <text
                      x={cx}
                      y={cy - 16}
                      fontSize={10}
                      textAnchor="middle"
                    >
                      💤
                    </text>
                  )}
                  {isActive && (
                    <circle
                      cx={cx + 9}
                      cy={cy - 9}
                      r={4}
                      fill="#4CAF50"
                      stroke="var(--room-bg)"
                      strokeWidth={1.5}
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
