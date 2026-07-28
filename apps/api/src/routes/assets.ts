import { Hono } from "hono";
import { writeFile, unlink, readdir, readFile, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

const ALLOWED_TYPES = new Set(["avatars", "rooms"] as const);

const MAX_SIZE_AVATAR = 500 * 1024;
const MAX_SIZE_ROOM = 2 * 1024 * 1024;
const MAX_DIMENSION = 4096;

export function getAssetsDir(): string {
  if (process.env.ASSETS_DIR) return resolve(process.env.ASSETS_DIR);
  return resolve(import.meta.dirname ?? ".", "../../../web/public/assets");
}

function isInsideDir(parentDir: string, childPath: string): boolean {
  const normalizedParent = resolve(parentDir) + sep;
  const normalizedChild = resolve(childPath);
  return normalizedChild.startsWith(normalizedParent);
}

function scanPngChunks(buf: Buffer): boolean {
  let offset = 8; // after signature
  let hasIDAT = false;
  let hasIEND = false;

  while (offset + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(offset);
    const chunkType = buf.toString("ascii", offset + 4, offset + 8);

    if (chunkType === "IDAT") hasIDAT = true;
    if (chunkType === "IEND") { hasIEND = true; break; }

    // chunk = 4 (len) + 4 (type) + chunkLen (data) + 4 (CRC)
    offset += 12 + chunkLen;
  }
  return hasIDAT && hasIEND;
}

function validatePng(buf: Buffer): { ext: string; width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (buf.length < 57) return null; // sig(8) + IHDR(25) + IDAT(12 min) + IEND(12)
  if (!sig.every((b, i) => buf[i] === b)) return null;

  const chunkLen = buf.readUInt32BE(8);
  if (chunkLen !== 13) return null;
  const chunkType = buf.toString("ascii", 12, 16);
  if (chunkType !== "IHDR") return null;

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;

  const bitDepth = buf[24];
  const colorType = buf[25];
  if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (![0, 2, 3, 4, 6].includes(colorType)) return null;

  if (!scanPngChunks(buf)) return null;

  return { ext: ".png", width, height };
}

function validateJpeg(buf: Buffer): { ext: string; width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;

  let offset = 2;
  let foundSOF = false;
  let width = 0;
  let height = 0;

  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xFF) return null;
    const marker = buf[offset + 1];
    if (marker === 0xD9) break; // EOI

    if (marker === 0xDA) {
      // SOS — scan data follows; image is structurally complete
      if (!foundSOF) return null;
      return { ext: ".jpg", width, height };
    }

    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (offset + 9 >= buf.length) return null;
      height = buf.readUInt16BE(offset + 5);
      width = buf.readUInt16BE(offset + 7);
      if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
      foundSOF = true;
    }

    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}

function validateWebp(buf: Buffer): { ext: string; width: number; height: number } | null {
  if (buf.length < 30) return null;
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (!riff.every((b, i) => buf[i] === b)) return null;
  if (!webp.every((b, i) => buf[i + 8] === b)) return null;

  const fileSize = buf.readUInt32LE(4);
  if (fileSize + 8 < 20) return null;

  const chunkFourCC = buf.toString("ascii", 12, 16);
  const chunkDataSize = buf.readUInt32LE(16);

  if (chunkFourCC === "VP8 " && buf.length >= 30) {
    if (buf[23] !== 0x9D || buf[24] !== 0x01 || buf[25] !== 0x2A) return null;
    const width = buf.readUInt16LE(26) & 0x3FFF;
    const height = buf.readUInt16LE(28) & 0x3FFF;
    if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
    if (chunkDataSize < 10) return null;
    return { ext: ".webp", width, height };
  }

  if (chunkFourCC === "VP8L" && buf.length >= 25) {
    if (buf[21] !== 0x2F) return null; // VP8L signature byte
    const b0 = buf[22]; const b1 = buf[23]; const b2 = buf[24];
    const width = (b0 | ((b1 & 0x3F) << 8)) + 1;
    const height = (((b1 >> 6) | (b2 << 2)) & 0x3FFF) + 1;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
    if (chunkDataSize < 5) return null;
    return { ext: ".webp", width, height };
  }

  if (chunkFourCC === "VP8X" && buf.length >= 30) {
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
    if (chunkDataSize < 10) return null;
    return { ext: ".webp", width, height };
  }

  return null;
}

export function validateImage(buf: Buffer): { ext: string; width: number; height: number } | null {
  return validatePng(buf) ?? validateJpeg(buf) ?? validateWebp(buf) ?? null;
}

// Public route: serves uploaded files without auth (for <img> tags)
const assetsPublic = new Hono();

assetsPublic.get("/:type/:filename{.+\\..+}", async (c) => {
  const type = c.req.param("type");
  const filename = c.req.param("filename");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.notFound();
  }

  const dir = join(getAssetsDir(), type);
  const filePath = join(dir, filename);

  if (!isInsideDir(dir, filePath)) {
    return c.notFound();
  }

  if (!existsSync(filePath)) {
    return c.notFound();
  }

  const data = await readFile(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Private routes: management operations (require auth)
const assets = new Hono();

assets.get("/:type", async (c) => {
  const type = c.req.param("type");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "invalid asset type" } }, 400);
  }

  const dir = join(getAssetsDir(), type);
  if (!existsSync(dir)) {
    return c.json({ ok: true, data: {} });
  }

  const files = (await readdir(dir)).filter((f) => !f.startsWith("."));
  const manifest: Record<string, string> = {};
  for (const f of files) {
    const id = f.replace(/\.[^.]+$/, "");
    manifest[id] = `/assets/${type}/${f}`;
  }
  return c.json({ ok: true, data: manifest });
});

assets.post("/:type/:id", async (c) => {
  const type = c.req.param("type");
  const id = c.req.param("id");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "invalid asset type" } }, 400);
  }

  if (!/^[a-z0-9_-]+$/i.test(id)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "invalid id" } }, 400);
  }

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!(file instanceof File)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "missing file field" } }, 400);
  }

  const maxSize = type === "avatars" ? MAX_SIZE_AVATAR : MAX_SIZE_ROOM;
  if (file.size > maxSize) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: `file too large (max ${maxSize / 1024}KB)` } }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = validateImage(buffer);
  if (!detected) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "corrupt or unsupported image: only decodable PNG, JPEG, WebP allowed" } }, 400);
  }

  const dir = join(getAssetsDir(), type);
  await mkdir(dir, { recursive: true });

  const existing = (await readdir(dir)).filter((f) => f.startsWith(id + "."));
  for (const old of existing) {
    await unlink(join(dir, old));
  }

  const filename = `${id}${detected.ext}`;
  await writeFile(join(dir, filename), buffer);

  const url = `/assets/${type}/${filename}`;
  return c.json({ ok: true, data: { url } }, 201);
});

assets.delete("/:type/:id", async (c) => {
  const type = c.req.param("type");
  const id = c.req.param("id");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "invalid asset type" } }, 400);
  }

  const dir = join(getAssetsDir(), type);
  if (!existsSync(dir)) {
    return c.json({ ok: false, error: { code: "NOT_FOUND", message: "asset not found" } }, 404);
  }

  const files = (await readdir(dir)).filter((f) => f.startsWith(id + "."));
  if (files.length === 0) {
    return c.json({ ok: false, error: { code: "NOT_FOUND", message: "asset not found" } }, 404);
  }

  for (const f of files) {
    await unlink(join(dir, f));
  }

  return c.json({ ok: true, data: null });
});

export { assets, assetsPublic };
