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

  it("forbidden 风险级别只允许 forbidden 审批策略", () => {
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "forbidden",
        approval_policy: "auto",
      }).success
    ).toBe(false);
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "forbidden",
        approval_policy: "require_confirmation",
      }).success
    ).toBe(false);
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "forbidden",
        approval_policy: "forbidden",
      }).success
    ).toBe(true);
  });

  it("external_side_effect 不允许 auto/auto_revocable", () => {
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "external_side_effect",
        approval_policy: "auto",
      }).success
    ).toBe(false);
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "external_side_effect",
        approval_policy: "auto_revocable",
      }).success
    ).toBe(false);
    expect(
      toolActionDefinitionSchema.safeParse({
        ...validAction,
        risk_level: "external_side_effect",
        approval_policy: "require_confirmation",
      }).success
    ).toBe(true);
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

  it("approved/auto_approved 允许所有 status", () => {
    for (const d of ["approved", "auto_approved"]) {
      for (const s of ["pending", "running", "completed", "failed", "cancelled"]) {
        expect(
          toolRunSchema.safeParse({
            ...validRun,
            permission_decision: d,
            status: s,
          }).success
        ).toBe(true);
      }
    }
  });

  it("pending 权限只允许 pending status", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        permission_decision: "pending",
        status: "pending",
      }).success
    ).toBe(true);
    for (const s of ["running", "completed", "failed", "cancelled"]) {
      expect(
        toolRunSchema.safeParse({
          ...validRun,
          permission_decision: "pending",
          status: s,
        }).success
      ).toBe(false);
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

  it("id 不接受空字符串", () => {
    expect(
      toolRunSchema.safeParse({ ...validRun, id: "" }).success
    ).toBe(false);
  });

  it("denied 只允许 cancelled status", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        permission_decision: "denied",
        status: "cancelled",
      }).success
    ).toBe(true);
    for (const s of ["pending", "running", "completed", "failed"]) {
      expect(
        toolRunSchema.safeParse({
          ...validRun,
          permission_decision: "denied",
          status: s,
        }).success
      ).toBe(false);
    }
  });

  it("forbidden 风险级别的 tool_run 只能是 denied", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        risk_level: "forbidden",
        permission_decision: "auto_approved",
      }).success
    ).toBe(false);
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        risk_level: "forbidden",
        permission_decision: "denied",
        status: "cancelled",
      }).success
    ).toBe(true);
  });

  it("expires_at 必须晚于 created_at", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        created_at: "2026-07-20T12:00:00Z",
        expires_at: "2026-07-20T11:00:00Z",
      }).success
    ).toBe(false);
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        created_at: "2026-07-20T12:00:00Z",
        expires_at: "2026-07-20T12:00:00Z",
      }).success
    ).toBe(false);
  });

  it("expires_at 小数秒仍正确比较（不使用字符串比较）", () => {
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        created_at: "2026-07-20T12:00:00Z",
        expires_at: "2026-07-20T12:00:00.001Z",
      }).success
    ).toBe(true);
    expect(
      toolRunSchema.safeParse({
        ...validRun,
        created_at: "2026-07-20T12:00:00.500Z",
        expires_at: "2026-07-20T12:00:00.001Z",
      }).success
    ).toBe(false);
  });
});
