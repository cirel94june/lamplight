import { describe, expect, it } from "vitest";
import {
  gatewayCompletionRequestSchema,
  gatewayCompletionResponseSchema,
  gatewayErrorSchema,
  gatewayMessageSchema,
} from "../src/index.js";

describe("gatewayMessageSchema", () => {
  it("accepts valid roles", () => {
    for (const role of ["system", "user", "assistant"]) {
      expect(
        gatewayMessageSchema.safeParse({ role, content: "hello" }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown role", () => {
    expect(
      gatewayMessageSchema.safeParse({ role: "tool", content: "hello" }).success,
    ).toBe(false);
  });
});

describe("gatewayCompletionRequestSchema", () => {
  const valid = {
    provider_id: "anthropic",
    model_id: "claude-opus-4-6",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts minimal valid request", () => {
    expect(gatewayCompletionRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields", () => {
    expect(
      gatewayCompletionRequestSchema.safeParse({
        ...valid,
        max_tokens: 1024,
        temperature: 0.7,
        stop_sequences: ["\n"],
      }).success,
    ).toBe(true);
  });

  it("rejects empty messages array", () => {
    expect(
      gatewayCompletionRequestSchema.safeParse({ ...valid, messages: [] }).success,
    ).toBe(false);
  });

  it("rejects empty provider_id", () => {
    expect(
      gatewayCompletionRequestSchema.safeParse({ ...valid, provider_id: "" }).success,
    ).toBe(false);
  });

  it("rejects temperature above 2", () => {
    expect(
      gatewayCompletionRequestSchema.safeParse({ ...valid, temperature: 2.5 }).success,
    ).toBe(false);
  });
});

describe("gatewayCompletionResponseSchema", () => {
  const valid = {
    content: "Hello!",
    usage: { input_tokens: 10, output_tokens: 5 },
    model_id: "claude-opus-4-6",
    provider_id: "anthropic",
    finish_reason: "end_turn",
  };

  it("accepts valid response", () => {
    expect(gatewayCompletionResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all finish_reason values", () => {
    for (const reason of ["end_turn", "max_tokens", "stop_sequence"]) {
      expect(
        gatewayCompletionResponseSchema.safeParse({ ...valid, finish_reason: reason })
          .success,
      ).toBe(true);
    }
  });

  it("rejects negative token counts", () => {
    expect(
      gatewayCompletionResponseSchema.safeParse({
        ...valid,
        usage: { input_tokens: -1, output_tokens: 5 },
      }).success,
    ).toBe(false);
  });
});

describe("gatewayErrorSchema", () => {
  it("accepts all error codes", () => {
    for (const code of [
      "provider_unavailable",
      "rate_limited",
      "timeout",
      "invalid_request",
      "unknown",
    ]) {
      expect(
        gatewayErrorSchema.safeParse({
          code,
          message: "something broke",
          retryable: false,
        }).success,
      ).toBe(true);
    }
  });

  it("accepts optional provider_id", () => {
    expect(
      gatewayErrorSchema.safeParse({
        code: "timeout",
        message: "timed out",
        provider_id: "openai",
        retryable: true,
      }).success,
    ).toBe(true);
  });
});
