import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("dotenv import order", () => {
  it("DATABASE_URL from env is used by db module (not hardcoded default)", () => {
    expect(process.env.DATABASE_URL).toBe("file::memory:");
  });

  it("db module connects to the env-specified database", async () => {
    const { db } = await import("../src/db/index.js");
    const result = await db.all(sql`SELECT 1 AS ok`);
    expect(result).toEqual([{ ok: 1 }]);
  });
});
