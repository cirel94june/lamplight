import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
  GatewayError,
} from "@lamplight/contracts";
import { GatewayService } from "../src/services/gateway/gateway-service.js";
import { AnthropicProvider } from "../src/services/gateway/anthropic-provider.js";
import { OpenAIProvider } from "../src/services/gateway/openai-provider.js";

function mockProvider(
  response: GatewayCompletionResponse,
): AIGateway {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function failingProvider(error: GatewayError, times = Infinity): AIGateway {
  let callCount = 0;
  return {
    complete: vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= times) {
        return Promise.reject(error);
      }
      return Promise.resolve({
        content: "recovered",
        usage: { input_tokens: 1, output_tokens: 1 },
        model_id: "test-model",
        provider_id: "test",
        finish_reason: "end_turn" as const,
      });
    }),
  };
}

const baseRequest: GatewayCompletionRequest = {
  provider_id: "anthropic",
  model_id: "claude-opus-4-6",
  messages: [{ role: "user", content: "hello" }],
};

const baseResponse: GatewayCompletionResponse = {
  content: "Hi there!",
  usage: { input_tokens: 10, output_tokens: 5 },
  model_id: "claude-opus-4-6",
  provider_id: "anthropic",
  finish_reason: "end_turn",
};

describe("GatewayService", () => {
  it("routes to the correct provider by provider_id", async () => {
    const gateway = new GatewayService();
    const anthropic = mockProvider({ ...baseResponse, provider_id: "anthropic" });
    const openai = mockProvider({
      ...baseResponse,
      provider_id: "openai",
      model_id: "gpt-4o",
    });
    gateway.register("anthropic", anthropic);
    gateway.register("openai", openai);

    const result = await gateway.complete(baseRequest);
    expect(result.provider_id).toBe("anthropic");
    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("routes to openai when provider_id is openai", async () => {
    const gateway = new GatewayService();
    const openai = mockProvider({
      ...baseResponse,
      provider_id: "openai",
      model_id: "gpt-4o",
    });
    gateway.register("openai", openai);

    const result = await gateway.complete({
      ...baseRequest,
      provider_id: "openai",
      model_id: "gpt-4o",
    });
    expect(result.provider_id).toBe("openai");
    expect(openai.complete).toHaveBeenCalledOnce();
  });

  it("throws structured error for unknown provider", async () => {
    const gateway = new GatewayService();
    try {
      await gateway.complete({
        ...baseRequest,
        provider_id: "unknown",
      });
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("provider_unavailable");
      expect(e.provider_id).toBe("unknown");
      expect(e.retryable).toBe(false);
    }
  });

  it("retries once on retryable error then succeeds", async () => {
    const gateway = new GatewayService();
    const provider = failingProvider(
      {
        code: "timeout",
        message: "timed out",
        provider_id: "anthropic",
        retryable: true,
      },
      1,
    );
    gateway.register("anthropic", provider);

    const result = await gateway.complete(baseRequest);
    expect(result.content).toBe("recovered");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const gateway = new GatewayService();
    const provider = failingProvider({
      code: "invalid_request",
      message: "bad request",
      provider_id: "anthropic",
      retryable: false,
    });
    gateway.register("anthropic", provider);

    try {
      await gateway.complete(baseRequest);
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("invalid_request");
      expect(e.retryable).toBe(false);
    }
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it("throws after retry exhaustion on retryable error", async () => {
    const gateway = new GatewayService();
    const provider = failingProvider({
      code: "rate_limited",
      message: "too many requests",
      provider_id: "anthropic",
      retryable: true,
    });
    gateway.register("anthropic", provider);

    try {
      await gateway.complete(baseRequest);
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("rate_limited");
    }
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("passes all request fields through to provider", async () => {
    const gateway = new GatewayService();
    const provider = mockProvider(baseResponse);
    gateway.register("anthropic", provider);

    const fullRequest: GatewayCompletionRequest = {
      provider_id: "anthropic",
      model_id: "claude-opus-4-6",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
      max_tokens: 512,
      temperature: 0.7,
      stop_sequences: ["\n"],
    };

    await gateway.complete(fullRequest);
    expect(provider.complete).toHaveBeenCalledWith(fullRequest);
  });

  it("logs usage to console", async () => {
    const gateway = new GatewayService();
    gateway.register("anthropic", mockProvider(baseResponse));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await gateway.complete(baseRequest);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("anthropic/claude-opus-4-6"),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("in=10 out=5"),
    );
    spy.mockRestore();
  });
});

describe("AnthropicProvider — error mapping", () => {
  it("maps APIConnectionTimeoutError to timeout + retryable", async () => {
    const provider = new AnthropicProvider("fake-key");
    // Stub the SDK call to throw a real timeout error
    vi.spyOn(provider["client"].messages, "create").mockRejectedValue(
      new Anthropic.APIConnectionTimeoutError({ message: "Request timed out" }),
    );

    try {
      await provider.complete(baseRequest);
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("timeout");
      expect(e.retryable).toBe(true);
      expect(e.provider_id).toBe("anthropic");
    }
  });

  it("maps 429 APIError to rate_limited + retryable", async () => {
    const provider = new AnthropicProvider("fake-key");
    vi.spyOn(provider["client"].messages, "create").mockRejectedValue(
      new Anthropic.RateLimitError(429, undefined, "rate limited", undefined),
    );

    try {
      await provider.complete(baseRequest);
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("rate_limited");
      expect(e.retryable).toBe(true);
    }
  });

  it("maps 400 APIError to invalid_request + not retryable", async () => {
    const provider = new AnthropicProvider("fake-key");
    vi.spyOn(provider["client"].messages, "create").mockRejectedValue(
      new Anthropic.BadRequestError(400, undefined, "bad request", undefined),
    );

    try {
      await provider.complete(baseRequest);
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("invalid_request");
      expect(e.retryable).toBe(false);
    }
  });

  it("SDK client is configured with maxRetries=0 and timeout=30s", () => {
    const provider = new AnthropicProvider("fake-key");
    const client = provider["client"];
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(30_000);
  });
});

describe("OpenAIProvider — error mapping", () => {
  it("maps APIConnectionTimeoutError to timeout + retryable", async () => {
    const provider = new OpenAIProvider("fake-key");
    vi.spyOn(provider["client"].chat.completions, "create").mockRejectedValue(
      new OpenAI.APIConnectionTimeoutError({ message: "Request timed out" }),
    );

    try {
      await provider.complete({
        ...baseRequest,
        provider_id: "openai",
        model_id: "gpt-4o",
      });
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("timeout");
      expect(e.retryable).toBe(true);
      expect(e.provider_id).toBe("openai");
    }
  });

  it("maps 429 APIError to rate_limited + retryable", async () => {
    const provider = new OpenAIProvider("fake-key");
    vi.spyOn(provider["client"].chat.completions, "create").mockRejectedValue(
      new OpenAI.RateLimitError(429, undefined, "rate limited", undefined),
    );

    try {
      await provider.complete({
        ...baseRequest,
        provider_id: "openai",
        model_id: "gpt-4o",
      });
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("rate_limited");
      expect(e.retryable).toBe(true);
    }
  });

  it("maps 400 APIError to invalid_request + not retryable", async () => {
    const provider = new OpenAIProvider("fake-key");
    vi.spyOn(provider["client"].chat.completions, "create").mockRejectedValue(
      new OpenAI.BadRequestError(400, undefined, "bad request", undefined),
    );

    try {
      await provider.complete({
        ...baseRequest,
        provider_id: "openai",
        model_id: "gpt-4o",
      });
      expect.fail("should have thrown");
    } catch (error) {
      const e = error as GatewayError;
      expect(e.code).toBe("invalid_request");
      expect(e.retryable).toBe(false);
    }
  });

  it("SDK client is configured with maxRetries=0 and timeout=30s", () => {
    const provider = new OpenAIProvider("fake-key");
    const client = provider["client"];
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(30_000);
  });
});
