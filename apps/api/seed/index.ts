import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { scenes, agentProfiles, agentRuntimeConfigs } from "../src/db/schema.js";
import { ROOMS } from "./rooms.js";
import { AGENT_PROFILES, AGENT_RUNTIME_CONFIGS } from "./agents.js";

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
      default_turn_policy: room.default_turn_policy ?? null,
    })
    .onConflictDoUpdate({
      target: scenes.scene_id,
      set: {
        display_name: room.display_name,
        type: room.type,
        prompt_weight_overrides: room.prompt_weight_overrides,
        max_participants: room.max_participants ?? null,
        furniture_slots: room.furniture_slots ?? null,
        default_turn_policy: room.default_turn_policy ?? null,
      },
    });
}

console.log(`[seed] upserted ${ROOMS.length} rooms`);

for (const profile of AGENT_PROFILES) {
  await db
    .insert(agentProfiles)
    .values({
      agent_id: profile.agent_id,
      display_name: profile.display_name,
      memory_scope: profile.memory_scope,
      tool_policy_id: profile.tool_policy_id ?? null,
      prompt_version: profile.prompt_version ?? null,
    })
    .onConflictDoUpdate({
      target: agentProfiles.agent_id,
      set: {
        display_name: profile.display_name,
        memory_scope: profile.memory_scope,
        tool_policy_id: profile.tool_policy_id ?? null,
        prompt_version: profile.prompt_version ?? null,
      },
    });
}

for (const config of AGENT_RUNTIME_CONFIGS) {
  await db
    .insert(agentRuntimeConfigs)
    .values({
      agent_id: config.agent_id,
      random_reply_affinity: config.random_reply_affinity,
      max_response_tokens: config.max_response_tokens ?? null,
      temperature: config.temperature ?? null,
      system_prompt_template: config.system_prompt_template ?? null,
    })
    .onConflictDoUpdate({
      target: agentRuntimeConfigs.agent_id,
      set: {
        random_reply_affinity: config.random_reply_affinity,
        max_response_tokens: config.max_response_tokens ?? null,
        temperature: config.temperature ?? null,
        system_prompt_template: config.system_prompt_template ?? null,
      },
    });
}

console.log(`[seed] upserted ${AGENT_PROFILES.length} agent profiles + runtime configs`);
