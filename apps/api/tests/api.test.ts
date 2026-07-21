import { describe, expect, it, beforeAll } from "vitest";
import { app } from "../src/app.js";

const TOKEN = "test-token-123";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

describe("GET /health", () => {
  it("returns 200 without auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { status: "healthy" } });
  });
});

describe("auth middleware", () => {
  it("rejects requests without token", async () => {
    const res = await app.request("/api/anything");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with wrong token", async () => {
    const res = await app.request("/api/anything", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("passes requests with correct token", async () => {
    const res = await app.request("/api/anything", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("rejects /scenes without token", async () => {
    const res = await app.request("/scenes");
    expect(res.status).toBe(401);
  });

  it("passes /scenes with correct token", async () => {
    const res = await app.request("/scenes", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});
