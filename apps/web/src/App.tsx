import { presenceSchema, type Presence } from "@lamplight/contracts";

// 演示：前端和后端 import 同一本字典。这条 Presence 与 apps/api 用的是同一个类型。
const placeholder: Presence = presenceSchema.parse({
  ai_id: "cloudy",
  scene_id: null,
  state: "idle",
  updated_at: new Date().toISOString(),
});

export function App() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>lamplight · 留灯</h1>
      <p>不管几点回来，家里永远有一盏灯亮着。</p>
      <p>
        monorepo 骨架已就位；contracts 字典演示——{placeholder.ai_id} 现在
        {placeholder.state === "idle" ? "在打盹" : "醒着"}。
      </p>
    </main>
  );
}
