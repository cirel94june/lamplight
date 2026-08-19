import { Hono } from "hono";
import { and, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

const householdDigest = new Hono();

householdDigest.get("/", async (c) => {
  const since = c.req.query("since");
  const until = c.req.query("until");

  const conditions = [];
  if (since) conditions.push(gte(schema.householdDigests.period_start, since));
  if (until) conditions.push(lte(schema.householdDigests.period_end, until));

  const rows = await db
    .select()
    .from(schema.householdDigests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(schema.householdDigests.created_at);

  return c.json({ ok: true, data: rows });
});

export { householdDigest };
