import { Hono } from "hono";
import { writeFile, unlink, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const ALLOWED_TYPES = new Set(["avatars", "rooms"] as const);

const MAGIC_BYTES: Array<{ mime: string; ext: string; sig: number[] }> = [
  { mime: "image/png", ext: ".png", sig: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/jpeg", ext: ".jpg", sig: [0xFF, 0xD8, 0xFF] },
  { mime: "image/webp", ext: ".webp", sig: [0x52, 0x49, 0x46, 0x46] },
];

const MAX_SIZE_AVATAR = 500 * 1024;
const MAX_SIZE_ROOM = 2 * 1024 * 1024;

const ASSETS_DIR = resolve(
  import.meta.dirname ?? ".",
  "../../../web/public/assets",
);

function detectFormat(buf: Buffer): { ext: string } | null {
  for (const { ext, sig } of MAGIC_BYTES) {
    if (sig.every((b, i) => buf[i] === b)) {
      if (ext === ".webp" && buf.length >= 12) {
        if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) return null;
      }
      return { ext };
    }
  }
  return null;
}

const assets = new Hono();

assets.get("/:type", async (c) => {
  const type = c.req.param("type");

  if (!ALLOWED_TYPES.has(type as any)) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "invalid asset type" } }, 400);
  }

  const dir = join(ASSETS_DIR, type);
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
  const detected = detectFormat(buffer);
  if (!detected) {
    return c.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "unsupported format: only PNG, JPEG, WebP allowed" } }, 400);
  }

  const dir = join(ASSETS_DIR, type);
  if (!existsSync(dir)) {
    return c.json({ ok: false, error: { code: "SERVER_ERROR", message: "asset directory not found" } }, 500);
  }

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

  const dir = join(ASSETS_DIR, type);
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
