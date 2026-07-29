import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { scenes } from "./routes/scenes.js";
import { events } from "./routes/events.js";
import { presence } from "./routes/presence.js";
import { conversations } from "./routes/conversations.js";
import { assets, assetsPublic } from "./routes/assets.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.route("/assets", assetsPublic);

app.use("*", authMiddleware);

app.route("/scenes", scenes);
app.route("/house-events", events);
app.route("/presence", presence);
app.route("/conversations", conversations);
app.route("/assets", assets);

export { app };
