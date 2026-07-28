import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { app } from "../src/app.js";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN = "test-token-123";
const ASSETS_DIR = resolve(import.meta.dirname, "../../web/public/assets");
const AVATARS_DIR = resolve(ASSETS_DIR, "avatars");
const ROOMS_DIR = resolve(ASSETS_DIR, "rooms");

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}` };
}

function makePng(width = 1, height = 1): Uint8Array {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const rest = new Array(64).fill(0);
  return new Uint8Array([...sig, ...rest]);
}

function makeJpeg(): Uint8Array {
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...new Array(60).fill(0)]);
}

function makeWebp(): Uint8Array {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const size = [0x00, 0x00, 0x00, 0x00];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return new Uint8Array([...riff, ...size, ...webp, ...new Array(52).fill(0)]);
}

function makeSvg(): Uint8Array {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>';
  return new TextEncoder().encode(xml);
}

function makeFormData(filename: string, data: Uint8Array, mime: string): FormData {
  const form = new FormData();
  form.append("file", new File([data], filename, { type: mime }));
  return form;
}

function cleanDir(dir: string) {
  try {
    const files = readdirSync(dir);
    for (const f of files) {
      if (f !== ".gitkeep") {
        rmSync(resolve(dir, f), { force: true });
      }
    }
  } catch { /* dir may not exist */ }
}

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(ROOMS_DIR, { recursive: true });
});

beforeEach(() => {
  cleanDir(AVATARS_DIR);
  cleanDir(ROOMS_DIR);
});

afterAll(() => {
  cleanDir(AVATARS_DIR);
  cleanDir(ROOMS_DIR);
});

describe("Assets API", () => {
  describe("GET /assets/:type (manifest)", () => {
    it("returns empty manifest for empty directory", async () => {
      const res = await app.request("/assets/avatars", { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({});
    });

    it("returns manifest with uploaded files", async () => {
      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });

      const res = await app.request("/assets/avatars", { headers: authHeaders() });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.xiaoke).toBe("/assets/avatars/xiaoke.png");
    });

    it("rejects invalid asset type", async () => {
      const res = await app.request("/assets/invalid", { headers: authHeaders() });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /assets/:type/:id (upload)", () => {
    it("accepts valid PNG upload", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.url).toBe("/assets/avatars/xiaoke.png");

      const files = readdirSync(AVATARS_DIR).filter((f) => f !== ".gitkeep");
      expect(files).toContain("xiaoke.png");
    });

    it("accepts valid JPEG upload", async () => {
      const res = await app.request("/assets/avatars/lucien", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.jpg", makeJpeg(), "image/jpeg"),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.url).toBe("/assets/avatars/lucien.jpg");
    });

    it("accepts valid WebP upload", async () => {
      const res = await app.request("/assets/rooms/room-living-room", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("room.webp", makeWebp(), "image/webp"),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.url).toBe("/assets/rooms/room-living-room.webp");
    });

    it("rejects SVG (active content security risk)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.svg", makeSvg(), "image/svg+xml"),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("unsupported format");

      const files = readdirSync(AVATARS_DIR).filter((f) => f !== ".gitkeep");
      expect(files).not.toContain("xiaoke.svg");
    });

    it("rejects SVG disguised with PNG MIME type", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makeSvg(), "image/png"),
      });
      expect(res.status).toBe(400);
    });

    it("rejects file with wrong magic bytes despite correct MIME", async () => {
      const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, ...new Array(60).fill(0)]);
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", garbage, "image/png"),
      });
      expect(res.status).toBe(400);
    });

    it("rejects oversized avatar", async () => {
      const big = new Uint8Array(501 * 1024);
      big[0] = 0x89; big[1] = 0x50; big[2] = 0x4E; big[3] = 0x47;
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("big.png", big, "image/png"),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toContain("too large");
    });

    it("replaces existing file on re-upload", async () => {
      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });

      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.jpg", makeJpeg(), "image/jpeg"),
      });

      const files = readdirSync(AVATARS_DIR).filter((f) => f !== ".gitkeep");
      expect(files).toContain("xiaoke.jpg");
      expect(files).not.toContain("xiaoke.png");
    });

    it("rejects invalid asset type", async () => {
      const res = await app.request("/assets/scripts/evil", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("evil.png", makePng(), "image/png"),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid id characters", async () => {
      const res = await app.request("/assets/avatars/bad%20name", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /assets/:type/:id", () => {
    it("deletes existing asset", async () => {
      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });

      const res = await app.request("/assets/avatars/xiaoke", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const files = readdirSync(AVATARS_DIR).filter((f) => f !== ".gitkeep");
      expect(files).not.toContain("xiaoke.png");
    });

    it("returns 404 for non-existent asset", async () => {
      const res = await app.request("/assets/avatars/nobody", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });
});
