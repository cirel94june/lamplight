import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(
  resolve(__dirname, "../src/index.ts"),
  "utf-8",
);

describe("dotenv import order in index.ts", () => {
  it("does not statically import ./app (must be dynamic to load after dotenv)", () => {
    const staticAppImport = /^import\s.*from\s+["']\.\/app/m;
    expect(indexSrc).not.toMatch(staticAppImport);
  });

  it("does not statically import @hono/node-server (must be dynamic to load after dotenv)", () => {
    const staticServeImport = /^import\s.*from\s+["']@hono\/node-server/m;
    expect(indexSrc).not.toMatch(staticServeImport);
  });

  it("calls dotenv config() before dynamic imports", () => {
    const configPos = indexSrc.indexOf("config(");
    const dynamicImportPos = indexSrc.indexOf('await import(');
    expect(configPos).toBeGreaterThan(-1);
    expect(dynamicImportPos).toBeGreaterThan(-1);
    expect(configPos).toBeLessThan(dynamicImportPos);
  });
});
