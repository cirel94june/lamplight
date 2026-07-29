import { Hono } from "hono";
import { writeFile, unlink, readdir, readFile, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";

const ALLOWED_TYPES = new Set(["avatars", "rooms"] as const);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"] as const);

const FORMAT_TO_EXT: Record<string, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
};

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

export async function validateImage(
  buf: Buffer,
): Promise<{ ext: string; width: number; height: number } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format as any)) return null;
    if (!meta.width || !meta.height) return null;
    if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) return null;

    // Force a full decode pass — metadata() alone only reads headers
    await sharp(buf).toBuffer();

    const ext = FORMAT_TO_EXT[meta.format];
    return { ext, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
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
  const detected = await validateImage(buffer);
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
