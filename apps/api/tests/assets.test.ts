import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { app } from "../src/app.js";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const TOKEN = "test-token-123";

let TEST_DIR: string;
let AVATARS_DIR: string;
let ROOMS_DIR: string;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}` };
}

function makePng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const ihdr = [
    0x00, 0x00, 0x00, 0x0D, // chunk length: 13
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02,             // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00,       // compression, filter, interlace
  ];
  const padding = new Array(42).fill(0);
  return new Uint8Array([...sig, ...ihdr, ...padding]);
}

function makeJpeg(): Uint8Array {
  const header = [0xFF, 0xD8, 0xFF, 0xE0];
  const padding = new Array(103).fill(0);
  return new Uint8Array([...header, ...padding]);
}

function makeWebp(): Uint8Array {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const size = [0x00, 0x00, 0x00, 0x00];
  const webp = [0x57, 0x45, 0x42, 0x50];
  const padding = new Array(18).fill(0);
  return new Uint8Array([...riff, ...size, ...webp, ...padding]);
}

function makeSvg(): Uint8Array {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>';
  return new TextEncoder().encode(xml);
}

function makeTruncatedPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
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
      rmSync(resolve(dir, f), { force: true });
    }
  } catch { /* dir may not exist */ }
}

beforeAll(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), "lamplight-assets-test-"));
  AVATARS_DIR = join(TEST_DIR, "avatars");
  ROOMS_DIR = join(TEST_DIR, "rooms");

  process.env.OWNER_TOKEN = TOKEN;
  process.env.ASSETS_DIR = TEST_DIR;

  mkdirSync(AVATARS_DIR, { recursive: true });
  mkdirSync(ROOMS_DIR, { recursive: true });
});

beforeEach(() => {
  cleanDir(AVATARS_DIR);
  cleanDir(ROOMS_DIR);
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.ASSETS_DIR;
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

      const files = readdirSync(AVATARS_DIR);
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
      expect(body.error.message).toContain("unsupported");

      const files = readdirSync(AVATARS_DIR);
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

    it("rejects truncated PNG (only 4 bytes)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makeTruncatedPng(), "image/png"),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("truncated");
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

      const files = readdirSync(AVATARS_DIR);
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

  describe("GET /assets/:type/:filename (static serving)", () => {
    it("serves uploaded file with correct content type", async () => {
      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });

      const res = await app.request("/assets/avatars/xiaoke.png", { headers: authHeaders() });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("returns 404 for non-existent file", async () => {
      const res = await app.request("/assets/avatars/nobody.png", { headers: authHeaders() });
      expect(res.status).toBe(404);
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

      const files = readdirSync(AVATARS_DIR);
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
