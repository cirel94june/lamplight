import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { scenes } from "./routes/scenes.js";
import { events } from "./routes/events.js";
import { presence } from "./routes/presence.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.use("*", authMiddleware);

app.route("/scenes", scenes);
app.route("/house-events", events);
app.route("/presence", presence);

export { app };
