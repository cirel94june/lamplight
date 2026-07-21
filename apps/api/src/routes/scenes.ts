import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

type SceneRow = typeof schema.scenes.$inferSelect;

function toResponse({ created_at, ...rest }: SceneRow) {
  return rest;
}

const scenes = new Hono();

scenes.get("/", async (c) => {
  const rows = await db.select().from(schema.scenes);
  return c.json({ ok: true, data: rows.map(toResponse) });
});

scenes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.scene_id, id));

  if (!row) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "scene not found" } },
      404,
    );
  }

  return c.json({ ok: true, data: toResponse(row) });
});

export { scenes };
