import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const { serve } = await import("@hono/node-server");
const { app } = await import("./app.js");
const { attachWebSocket } = await import("./ws.js");

const PORT = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[lamplight-api] listening on :${info.port}`);
});

attachWebSocket(server as import("node:http").Server);
