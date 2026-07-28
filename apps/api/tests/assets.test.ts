import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { app } from "../src/app.js";
import { mkdirSync, rmSync, readdirSync, writeFileSync } from "node:fs";
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

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}

function pngChunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  return [...u32be(data.length), ...typeBytes, ...data, ...u32be(0)]; // CRC=0 (not checked)
}

function makePng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const ihdrData = [
    ...u32be(1), // width
    ...u32be(1), // height
    0x08, 0x02,  // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00,
  ];
  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", [0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00, 0x01, 0x01, 0x00]);
  const iend = pngChunk("IEND", []);
  return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

function makeHeaderOnlyPng(): Uint8Array {
  // Valid signature + valid IHDR, but no IDAT or IEND
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const ihdrData = [
    ...u32be(1), ...u32be(1),
    0x08, 0x02, 0x00, 0x00, 0x00,
  ];
  const ihdr = pngChunk("IHDR", ihdrData);
  return new Uint8Array([...sig, ...ihdr]);
}

function makeJpeg(): Uint8Array {
  const soi = [0xFF, 0xD8];
  const app0Marker = [0xFF, 0xE0];
  const app0Len = [0x00, 0x10];
  const app0Body = new Array(14).fill(0);
  const sof0Marker = [0xFF, 0xC0];
  const sof0Len = [0x00, 0x0B];
  const sof0Body = [0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00];
  // SOS marker (required for structural completeness)
  const sosMarker = [0xFF, 0xDA];
  const sosLen = [0x00, 0x08];
  const sosBody = [0x01, 0x01, 0x00, 0x00, 0x3F, 0x00];
  const scanData = new Array(10).fill(0);
  return new Uint8Array([
    ...soi, ...app0Marker, ...app0Len, ...app0Body,
    ...sof0Marker, ...sof0Len, ...sof0Body,
    ...sosMarker, ...sosLen, ...sosBody, ...scanData,
  ]);
}

function makeHeaderOnlyJpeg(): Uint8Array {
  // Valid SOI + APP0 + SOF0 but no SOS
  const soi = [0xFF, 0xD8];
  const app0Marker = [0xFF, 0xE0];
  const app0Len = [0x00, 0x10];
  const app0Body = new Array(14).fill(0);
  const sof0Marker = [0xFF, 0xC0];
  const sof0Len = [0x00, 0x0B];
  const sof0Body = [0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00];
  const eoi = [0xFF, 0xD9];
  return new Uint8Array([
    ...soi, ...app0Marker, ...app0Len, ...app0Body,
    ...sof0Marker, ...sof0Len, ...sof0Body, ...eoi,
  ]);
}

function makeWebp(): Uint8Array {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  const vp8 = [0x56, 0x50, 0x38, 0x20];
  const vp8Frame = [
    0x30, 0x01, 0x00,
    0x9D, 0x01, 0x2A,
    0x01, 0x00,
    0x01, 0x00,
    ...new Array(8).fill(0),
  ];
  const vp8ChunkSize = [vp8Frame.length & 0xFF, (vp8Frame.length >> 8) & 0xFF, 0x00, 0x00];
  const totalPayload = webp.length + vp8.length + vp8ChunkSize.length + vp8Frame.length;
  const fileSize = [totalPayload & 0xFF, (totalPayload >> 8) & 0xFF, 0x00, 0x00];
  return new Uint8Array([...riff, ...fileSize, ...webp, ...vp8, ...vp8ChunkSize, ...vp8Frame]);
}

function makeSvg(): Uint8Array {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>';
  return new TextEncoder().encode(xml);
}

function makeTruncatedPng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
}

function makeCorruptPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const ihdrData = [
    ...u32be(0), // width: 0 (invalid)
    ...u32be(1),
    0x08, 0x02, 0x00, 0x00, 0x00,
  ];
  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", [0x08, 0xD7, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const iend = pngChunk("IEND", []);
  return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

function makeCorruptJpeg(): Uint8Array {
  const soi = [0xFF, 0xD8];
  const app0Marker = [0xFF, 0xE0];
  const app0Len = [0x00, 0x10];
  const app0Body = new Array(14).fill(0);
  const sof0Marker = [0xFF, 0xC0];
  const sof0Len = [0x00, 0x0B];
  const sof0Body = [0x08, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]; // height: 0
  return new Uint8Array([...soi, ...app0Marker, ...app0Len, ...app0Body,
    ...sof0Marker, ...sof0Len, ...sof0Body]);
}

function makeCorruptWebp(): Uint8Array {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  const vp8 = [0x56, 0x50, 0x38, 0x20];
  const vp8Frame = [
    0x30, 0x01, 0x00,
    0x9D, 0x01, 0x2A,
    0x00, 0x00, // width: 0 (invalid)
    0x01, 0x00,
    ...new Array(8).fill(0),
  ];
  const vp8ChunkSize = [vp8Frame.length & 0xFF, (vp8Frame.length >> 8) & 0xFF, 0x00, 0x00];
  const totalPayload = webp.length + vp8.length + vp8ChunkSize.length + vp8Frame.length;
  const fileSize = [totalPayload & 0xFF, (totalPayload >> 8) & 0xFF, 0x00, 0x00];
  return new Uint8Array([...riff, ...fileSize, ...webp, ...vp8, ...vp8ChunkSize, ...vp8Frame]);
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
      expect(body.error.message).toContain("corrupt");
    });

    it("rejects PNG with valid IHDR but no IDAT/IEND (header-only)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makeHeaderOnlyPng(), "image/png"),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("corrupt");
    });

    it("rejects JPEG with valid SOF but no SOS (header-only)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.jpg", makeHeaderOnlyJpeg(), "image/jpeg"),
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

    it("rejects PNG with valid signature but corrupt IHDR (width=0)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makeCorruptPng(), "image/png"),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("corrupt");
    });

    it("rejects JPEG with valid markers but corrupt SOF (height=0)", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.jpg", makeCorruptJpeg(), "image/jpeg"),
      });
      expect(res.status).toBe(400);
    });

    it("rejects WebP with valid RIFF header but corrupt VP8 (width=0)", async () => {
      const res = await app.request("/assets/rooms/room-1", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("room.webp", makeCorruptWebp(), "image/webp"),
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

    it("serves files WITHOUT auth (public for <img> tags)", async () => {
      await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        headers: authHeaders(),
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });

      const res = await app.request("/assets/avatars/xiaoke.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("returns 404 for non-existent file", async () => {
      const res = await app.request("/assets/avatars/nobody.png");
      expect(res.status).toBe(404);
    });

    it("blocks path traversal via encoded backslash (..%5C)", async () => {
      writeFileSync(join(TEST_DIR, "secret.txt"), "do-not-read");

      const res = await app.request("/assets/avatars/..%5Csecret.txt");
      expect(res.status).toBe(404);
    });

    it("blocks path traversal via encoded slash (..%2F)", async () => {
      writeFileSync(join(TEST_DIR, "secret.txt"), "do-not-read");

      const res = await app.request("/assets/avatars/..%2Fsecret.txt");
      expect(res.status).toBe(404);
    });

    it("blocks double-dot traversal (../)", async () => {
      writeFileSync(join(TEST_DIR, "secret.txt"), "do-not-read");

      const res = await app.request("/assets/avatars/../secret.txt");
      // Router resolves ../ before handler — lands on /assets/secret.txt (not a valid type)
      expect(res.status).not.toBe(200);
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

  describe("auth enforcement", () => {
    it("manifest requires auth", async () => {
      const res = await app.request("/assets/avatars");
      expect(res.status).toBe(401);
    });

    it("upload requires auth", async () => {
      const res = await app.request("/assets/avatars/xiaoke", {
        method: "POST",
        body: makeFormData("avatar.png", makePng(), "image/png"),
      });
      expect(res.status).toBe(401);
    });

    it("delete requires auth", async () => {
      const res = await app.request("/assets/avatars/xiaoke", { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });
});
