import { describe, expect, it } from "vitest";
import {
  toolRiskLevelSchema,
  toolActionDefinitionSchema,
  toolRunSchema,
  toolRunSourceSchema,
} from "../src/index.js";

describe("ToolRiskLevel", () => {
  it("五档风险级别均合法", () => {
    for (const level of [
      "read_only",
      "internal_write",
      "device_action",
      "external_side_effect",
      "forbidden",
    ]) {
      expect(toolRiskLevelSchema.safeParse(level).success).toBe(true);
    }
  });

  it("非法风险级别被拒", () => {
    expect(toolRiskLevelSchema.safeParse("admin").success).toBe(false);
  });
});

describe("ToolActionDefinition", () => {
  const validAction = {
    tool_id: "maps",
    action: "search_place",
    risk_level: "read_only",
    approval_policy: "auto",
  } as const;

  it("合法定义能通过", () => {
    expect(toolActionDefinitionSchema.safeParse(validAction).success).toBe(
      true
    );
  });

  it("带可选 description 能通过", () => {
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        description: "搜索地点",
      }).success
    ).toBe(true);
  });

  it("五种审批策略均合法", () => {
    for (const p of [
      "auto",
      "auto_revocable",
      "configurable",
      "require_confirmation",
      "forbidden",
    ]) {
      expect(
        toolActionDefinitionSchema.safeParse({
          ...validAction,
          approval_policy: p,
        }).success
      ).toBe(true);
    }
  });

  it("tool_id / action 不接受空字符串", () => {
    expect(
      toolActionDefinitionSchema.safeParse({ ...validAction, tool_id: "" })
        .success
    ).toBe(false);
    expect(
      toolActionDefinitionSchema.safeParse({ ...validAction, action: "" })
        .success
    ).toBe(false);
  });
});

describe("ToolRunSource", () => {
  it("三种来源均合法", () => {
    for (const s of ["user_request", "conversation", "autonomous_pulse"]) {
      expect(toolRunSourceSchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("ToolRun", () => {
  const validRun = {
    id: "tr_1",
    actor_id: "cloudy",
    tool_id: "maps",
    action: "search_place",
    source: "conversation",
    risk_level: "read_only",
    permission_decision: "auto_approved",
    status: "completed",
    created_at: "2026-07-20T12:00:00Z",
  } as const;

  it("最小合法 tool_run 能通过", () => {
    expect(toolRunSchema.safeParse(validRun).success).toBe(true);
  });

  it("带可选字段能通过", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        arguments_summary: "query: 公司附近的咖啡店",
        result_ref: "result_abc",
        expires_at: "2026-07-20T13:00:00Z",
      }).success
    ).toBe(true);
  });

  it("actor_id 不接受空字符串", () => {
    expect(
      toolRunSchema.safeParse({ ...validRun, actor_id: "" }).success
    ).toBe(false);
  });

  it("permission_decision 四种状态均合法", () => {
    for (const d of ["approved", "auto_approved", "denied", "pending"]) {
      expect(
        toolRunSchema.safeParse({ ...validRun, permission_decision: d })
          .success
      ).toBe(true);
    }
  });

  it("status 五种状态均合法", () => {
    for (const s of [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(
        toolRunSchema.safeParse({ ...validRun, status: s }).success
      ).toBe(true);
    }
  });

  it("created_at 必须是合法 datetime", () => {
    expect(
      toolRunSchema.safeParse({ ...validRun, created_at: "not-a-date" })
        .success
    ).toBe(false);
  });

  it("expires_at 必须是合法 datetime（如果提供）", () => {
    expect(
      toolRunSchema.safeParse({ ...validRun, expires_at: "tomorrow" }).success
    ).toBe(false);
  });
});
