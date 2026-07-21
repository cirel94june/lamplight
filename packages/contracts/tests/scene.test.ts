import { describe, expect, it } from "vitest";
import { sceneDefinitionSchema } from "../src/scene.js";

describe("sceneDefinitionSchema", () => {
  const valid = {
    scene_id: "room-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: { psychology: 0.35 },
  };

  it("accepts a valid scene", () => {
    expect(sceneDefinitionSchema.parse(valid)).toBeDefined();
  });

  it("defaults prompt_weight_overrides to empty object", () => {
    const { prompt_weight_overrides, ...rest } = valid;
    const result = sceneDefinitionSchema.parse(rest);
    expect(result.prompt_weight_overrides).toEqual({});
  });

  it("accepts optional max_participants and furniture_slots", () => {
    const result = sceneDefinitionSchema.parse({
      ...valid,
      max_participants: 4,
      furniture_slots: 2,
    });
    expect(result.max_participants).toBe(4);
    expect(result.furniture_slots).toBe(2);
  });

  it("rejects empty scene_id", () => {
    expect(() =>
      sceneDefinitionSchema.parse({ ...valid, scene_id: "" }),
    ).toThrow();
  });

  it("rejects empty display_name", () => {
    expect(() =>
      sceneDefinitionSchema.parse({ ...valid, display_name: "" }),
    ).toThrow();
  });

  it("rejects empty type", () => {
    expect(() =>
      sceneDefinitionSchema.parse({ ...valid, type: "" }),
    ).toThrow();
  });

  it("type is open string, not enum — accepts any non-empty value", () => {
    const result = sceneDefinitionSchema.parse({
      ...valid,
      type: "game_world",
    });
    expect(result.type).toBe("game_world");
  });

  it("rejects prompt_weight below 0", () => {
    expect(() =>
      sceneDefinitionSchema.parse({
        ...valid,
        prompt_weight_overrides: { x: -0.1 },
      }),
    ).toThrow();
  });

  it("rejects prompt_weight above 1", () => {
    expect(() =>
      sceneDefinitionSchema.parse({
        ...valid,
        prompt_weight_overrides: { x: 1.5 },
      }),
    ).toThrow();
  });

  it("rejects negative max_participants", () => {
    expect(() =>
      sceneDefinitionSchema.parse({ ...valid, max_participants: -1 }),
    ).toThrow();
  });

  it("rejects non-integer furniture_slots", () => {
    expect(() =>
      sceneDefinitionSchema.parse({ ...valid, furniture_slots: 2.5 }),
    ).toThrow();
  });

  it("accepts null for max_participants and furniture_slots (DB compat)", () => {
    const result = sceneDefinitionSchema.parse({
      ...valid,
      max_participants: null,
      furniture_slots: null,
    });
    expect(result.max_participants).toBeNull();
    expect(result.furniture_slots).toBeNull();
  });

  it("accepts created_at from DB response", () => {
    const result = sceneDefinitionSchema.parse({
      ...valid,
      created_at: "2026-07-21 03:59:52",
    });
    expect(result.created_at).toBe("2026-07-21 03:59:52");
  });
});
