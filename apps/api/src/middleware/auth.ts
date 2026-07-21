import { createMiddleware } from "hono/factory";

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = process.env.OWNER_TOKEN;
  if (!token) {
    console.error("[auth] OWNER_TOKEN not set");
    return c.json({ ok: false, error: { code: "SERVER_ERROR", message: "auth not configured" } }, 500);
  }

  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "missing bearer token" } }, 401);
  }

  const provided = header.slice(7);
  if (provided !== token) {
    return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "invalid token" } }, 401);
  }

  await next();
});
