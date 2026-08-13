import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import * as storage from "../src/lib/storage";

/*
 * The background checksum queue (issue 32, PRD §11.3).
 *
 * A real temp storage root, a real SQLite file, and real files on disk —
 * whether the computed hash actually matches the bytes, and whether two jobs
 * genuinely never overlap, are facts about a real queue draining real I/O,
 * not something a mock of the queue itself could prove.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-checksum-"));
  root = join(dir, "storage");
  mkdirSync(root);

  const dbUrl = `file:${join(dir, "checksum.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  resetEnvCache();
});

afterAll(() => {
  rmSync(resolve(root, ".."), { recursive: true, force: true });
});

beforeEach(async () => {
  const { prisma } = await import("../src/lib/db");
  await prisma.tool.deleteMany();
  vi.restoreAllMocks();
});

async function makeTool(fileName: string, content: string | Buffer): Promise<{ id: string; absolute: string }> {
  writeFileSync(join(root, fileName), content);
  const { prisma } = await import("../src/lib/db");
  const tool = await prisma.tool.create({
    data: {
      slug: fileName.replace(/[^a-z0-9]/gi, "-").toLowerCase(),
      name: fileName,
      description: "test fixture",
      category: "Test",
      version: "1.0",
      filePath: join(root, fileName),
      fileName,
      fileSize: BigInt(Buffer.byteLength(content)),
      mimeType: "application/octet-stream",
    },
  });
  return { id: tool.id, absolute: join(root, fileName) };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for condition");
}

describe("enqueueChecksum", () => {
  it("returns immediately — the caller is never blocked on the hash", async () => {
    const { id, absolute } = await makeTool("instant.bin", "x".repeat(1024));
    const { enqueueChecksum } = await import("../src/lib/checksum");
    const { prisma } = await import("../src/lib/db");

    enqueueChecksum(id, absolute); // synchronous call, not awaited

    // Immediately after — before any microtask has had a chance to run the
    // hash — the row must still show the pending state.
    const row = await prisma.tool.findUniqueOrThrow({ where: { id } });
    expect(row.checksum).toBeNull();
  });

  it("computes the same SHA-256 an independent hash of the same bytes would", async () => {
    const content = "the quick brown fox jumps over the lazy dog".repeat(50_000);
    const { id, absolute } = await makeTool("real.bin", content);
    const expected = createHash("sha256").update(content).digest("hex");

    const { enqueueChecksum } = await import("../src/lib/checksum");
    const { prisma } = await import("../src/lib/db");
    enqueueChecksum(id, absolute);

    await waitFor(async () => (await prisma.tool.findUniqueOrThrow({ where: { id } })).checksum !== null);

    const row = await prisma.tool.findUniqueOrThrow({ where: { id } });
    expect(row.checksum).toBe(expected);
    expect(row.checksumAt).not.toBeNull();
  });

  it("never runs two hashes at once — the second waits for the first", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const real = storage.hashFile;

    vi.spyOn(storage, "hashFile").mockImplementation(async (absolute: string) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // A small artificial delay makes the overlap window wide enough that a
      // real bug (parallel execution) would reliably be caught, not just
      // occasionally missed by scheduling luck.
      await new Promise((r) => setTimeout(r, 30));
      const result = await real(absolute);
      concurrent -= 1;
      return result;
    });

    const a = await makeTool("a.bin", "a".repeat(2048));
    const b = await makeTool("b.bin", "b".repeat(2048));
    const { enqueueChecksum } = await import("../src/lib/checksum");
    const { prisma } = await import("../src/lib/db");

    enqueueChecksum(a.id, a.absolute);
    enqueueChecksum(b.id, b.absolute);

    await waitFor(async () => {
      const [rowA, rowB] = await Promise.all([
        prisma.tool.findUniqueOrThrow({ where: { id: a.id } }),
        prisma.tool.findUniqueOrThrow({ where: { id: b.id } }),
      ]);
      return rowA.checksum !== null && rowB.checksum !== null;
    });

    expect(maxConcurrent).toBe(1);
  });

  it("keeps draining after one job fails (a deleted or unreadable file)", async () => {
    const { id: goodId, absolute: goodAbsolute } = await makeTool("good.bin", "y".repeat(1024));
    const badAbsolute = join(root, "does-not-exist.bin");
    const { prisma } = await import("../src/lib/db");
    const badTool = await prisma.tool.create({
      data: {
        slug: "bad-tool",
        name: "bad",
        description: "test fixture",
        category: "Test",
        version: "1.0",
        filePath: badAbsolute,
        fileName: "does-not-exist.bin",
        fileSize: 0n,
        mimeType: "application/octet-stream",
      },
    });

    const { enqueueChecksum } = await import("../src/lib/checksum");
    enqueueChecksum(badTool.id, badAbsolute); // will fail — the file does not exist
    enqueueChecksum(goodId, goodAbsolute); // must still run afterwards

    await waitFor(async () => (await prisma.tool.findUniqueOrThrow({ where: { id: goodId } })).checksum !== null);

    const good = await prisma.tool.findUniqueOrThrow({ where: { id: goodId } });
    const bad = await prisma.tool.findUniqueOrThrow({ where: { id: badTool.id } });
    expect(good.checksum).not.toBeNull();
    expect(bad.checksum).toBeNull(); // the failed job left no trace of success
  });
});
