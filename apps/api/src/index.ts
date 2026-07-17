import { createServer } from "node:http";
import {
  presenceSchema,
  type ApiResponse,
  type Presence,
} from "@lamplight/contracts";

/**
 * House API / BFF 壳：前端唯一的对话对象。
 * Hub Core / Tool Gateway 的转发逻辑在后续施工单接入；
 * 密钥只从环境变量读，永不进代码。
 */
const PORT = Number(process.env.PORT ?? 8787);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    // 演示：与 apps/web 用同一本字典里的同一个 Presence 类型
    const presence: Presence = presenceSchema.parse({
      ai_id: "cloudy",
      scene_id: null,
      state: "active",
      updated_at: new Date().toISOString(),
    });
    const body: ApiResponse<Presence> = { ok: true, data: presence };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  const notFound: ApiResponse<never> = {
    ok: false,
    error: { code: "NOT_FOUND", message: `no route for ${req.url}` },
  };
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify(notFound));
});

server.listen(PORT, () => {
  console.log(`[lamplight-api] listening on :${PORT}`);
});
