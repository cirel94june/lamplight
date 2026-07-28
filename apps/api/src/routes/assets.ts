import { Hono } from "hono";
import { writeFile, unlink, readdir, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const ALLOWED_TYPES = new Set(["avatars", "rooms"] as const);

const MIN_VALID_SIZE: Record<string, number> = {
  ".png": 67,
  ".jpg": 107,
  ".webp": 30,
};

const MAGIC_BYTES: Array<{ ext: string; sig: number[]; minLen: number }> = [
  { ext: ".png", sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], minLen: 67 },
  { ext: ".jpg", sig: [0xFF, 0xD8, 0xFF], minLen: 107 },
  { ext: ".webp", sig: [0x52, 0x49, 0x46, 0x46], minLen: 30 },
];

const MAX_SIZE_AVATAR = 500 * 1024;
const MAX_SIZE_ROOM = 2 * 1024 * 1024;

export function getAssetsDir(): string {
  if (process.env.ASSETS_DIR) return resolve(process.env.ASSETS_DIR);
  return resolve(import.meta.dirname ?? ".", "../../../web/public/assets");
}

function detectFormat(buf: Buffer): { ext: string } | null {
  for (const { ext, sig, minLen } of MAGIC_BYTES) {
    if (buf.length < minLen) continue;
    if (!sig.every((b, i) => buf[i] === b)) continue;
    if (ext === ".webp") {
      if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) continue;
    }
    return { ext };
  }
  return null;
}

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

assets.get("/:type/:filename{.+\\..+}", async (c) => {
  const type = c.req.param("type");
  const filename = c.req.param("filename");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.notFound();
  }

  const filePath = join(getAssetsDir(), type, filename);
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
  const detected = detectFormat(buffer);
  if (!detected) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "unsupported or truncated image: only valid PNG, JPEG, WebP allowed" } }, 400);
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

export { assets };
