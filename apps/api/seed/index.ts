import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { scenes } from "../src/db/schema.js";
import { ROOMS } from "./rooms.js";

const DB_URL = process.env.DATABASE_URL ?? "file:lamplight.db";
const client = createClient({ url: DB_URL });
const db = drizzle(client);

await migrate(db, { migrationsFolder: "./migrations" });

for (const room of ROOMS) {
  await db
    .insert(scenes)
    .values({
      scene_id: room.scene_id,
      display_name: room.display_name,
      type: room.type,
      prompt_weight_overrides: room.prompt_weight_overrides,
      max_participants: room.max_participants ?? null,
      furniture_slots: room.furniture_slots ?? null,
    })
    .onConflictDoUpdate({
      target: scenes.scene_id,
      set: {
        display_name: room.display_name,
        type: room.type,
        prompt_weight_overrides: room.prompt_weight_overrides,
        max_participants: room.max_participants ?? null,
        furniture_slots: room.furniture_slots ?? null,
      },
    });
}

console.log(`[seed] upserted ${ROOMS.length} rooms`);
