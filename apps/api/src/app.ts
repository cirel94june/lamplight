import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";
import { scenes } from "./routes/scenes.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.use("*", authMiddleware);

app.route("/scenes", scenes);

export { app };
