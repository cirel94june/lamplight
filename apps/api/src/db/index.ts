import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const DB_URL = process.env.DATABASE_URL ?? "file:lamplight.db";

const client = createClient({ url: DB_URL });

export const db = drizzle(client, { schema });
export { schema };
