import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const DB_URL = process.env.DATABASE_URL ?? "file:lamplight.db";

const client = createClient({ url: DB_URL });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./migrations" });
console.log("[migrate] done");
