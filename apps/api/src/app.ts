import { Hono } from "hono";
import { authMiddleware } from "./middleware/auth.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, data: { status: "healthy" } }));

app.use("*", authMiddleware);

export { app };
