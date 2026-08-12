import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient, ensureWal, toolVisibilityWhere } from "../src/lib/db";

const repoRoot = resolve(import.meta.dirname, "..");

let dir: string;
let db: PrismaClient;

/**
 * A real SQLite file with the real schema, pushed by the real CLI. Asserting the
 * shape of a `where` object proves nothing about whether SQLite honours it, and
 * the BigInt and visibility behaviour are the two things most likely to break.
 */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "labsy-db-"));
  const url = `file:${join(dir, "test.db")}`;

  execFileSync("npx", ["prisma", "db", "push", "--url", url], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  db = createPrismaClient(url);
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const baseTool = {
  name: "Ubuntu 22.04.4 LTS Server",
  description: "Minimal server image with cloud-init and the standard Labsy provisioning overlay.",
  category: "OS Images",
  version: "22.04.4",
  filePath: "/srv/downloads/isos/ubuntu-22.04.4-live-server-amd64.iso",
  fileName: "ubuntu-22.04.4-live-server-amd64.iso",
  fileSize: 2_306_867_200n,
};

describe("toolVisibilityWhere", () => {
  it("hides drafts and internal tools from anonymous callers", () => {
    expect(toolVisibilityWhere(false)).toEqual({ published: true, visibility: "public" });
  });

  it("shows everything to an admin", () => {
    expect(toolVisibilityWhere(true)).toEqual({});
  });

  it("survives being spread first, which is how every call site must use it", () => {
    const where = { ...toolVisibilityWhere(false), category: "OS Images" };
    expect(where).toEqual({ published: true, visibility: "public", category: "OS Images" });
  });
});

describe("visibility against a real database", () => {
  beforeAll(async () => {
    await db.tool.createMany({
      data: [
        { ...baseTool, slug: "public-tool", name: "Public Tool" },
        { ...baseTool, slug: "draft-tool", name: "Draft Tool", published: false },
        { ...baseTool, slug: "internal-tool", name: "Internal Tool", visibility: "admin" },
        {
          ...baseTool,
          slug: "draft-internal-tool",
          name: "Draft Internal Tool",
          published: false,
          visibility: "admin",
        },
      ],
    });
  });

  it("returns only the published, public tool to an anonymous caller", async () => {
    const tools = await db.tool.findMany({ where: { ...toolVisibilityWhere(false) } });
    expect(tools.map((t) => t.slug)).toEqual(["public-tool"]);
  });

  it("returns all four to an admin", async () => {
    const tools = await db.tool.findMany({ where: { ...toolVisibilityWhere(true) } });
    expect(tools).toHaveLength(4);
  });

  it("still excludes a draft when a caller adds its own filters after the spread", async () => {
    const tools = await db.tool.findMany({
      where: { ...toolVisibilityWhere(false), category: "OS Images" },
    });
    expect(tools.map((t) => t.slug)).toEqual(["public-tool"]);
  });

  it("finds nothing for an out-of-scope slug, which is what makes a 404 possible", async () => {
    const tool = await db.tool.findFirst({
      where: { ...toolVisibilityWhere(false), slug: "internal-tool" },
    });
    expect(tool).toBeNull();
  });
});

describe("BigInt file sizes", () => {
  it("round-trips a size above 2^53 without losing precision", async () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1, the first integer a double cannot hold

    await db.tool.create({
      data: { ...baseTool, slug: "huge-tool", name: "Huge Tool", fileSize: huge },
    });
    const found = await db.tool.findUniqueOrThrow({ where: { slug: "huge-tool" } });

    expect(found.fileSize).toBe(huge);
    expect(Number(found.fileSize)).not.toBe(huge); // why serialize.ts exists
  });
});

describe("schema", () => {
  it("defaults a new tool to published and public", async () => {
    const tool = await db.tool.create({
      data: { ...baseTool, slug: "defaults-tool", name: "Defaults Tool" },
    });

    expect(tool.published).toBe(true);
    expect(tool.visibility).toBe("public");
    expect(tool.featured).toBe(false);
    expect(tool.isSeed).toBe(false);
    expect(tool.fileMissing).toBe(false);
    expect(tool.downloadCount).toBe(0);
    expect(tool.lastDownloadAt).toBeNull();
    expect(tool.checksum).toBeNull();
  });

  it("enforces slug uniqueness", async () => {
    await db.tool.create({ data: { ...baseTool, slug: "unique-tool", name: "Unique Tool" } });
    await expect(
      db.tool.create({ data: { ...baseTool, slug: "unique-tool", name: "Clashing Tool" } }),
    ).rejects.toThrow();
  });

  it("keeps the three indexes PRD §6 declares, including the one powering the Stale report", async () => {
    const indexes = await db.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Tool'",
    );
    const names = indexes.map((i) => i.name);

    expect(names).toContain("Tool_category_idx");
    expect(names).toContain("Tool_published_visibility_createdAt_idx");
    expect(names).toContain("Tool_lastDownloadAt_idx");
  });
});

describe("SQLite pragmas", () => {
  it("opens new databases in delete mode, which is why ensureWal has to exist", async () => {
    const fresh = createPrismaClient(`file:${join(dir, "fresh.db")}`);
    try {
      const [{ journal_mode }] = await fresh.$queryRawUnsafe<{ journal_mode: string }[]>(
        "PRAGMA journal_mode",
      );
      expect(journal_mode).not.toBe("wal");
    } finally {
      await fresh.$disconnect();
    }
  });

  it("switches to WAL and persists it into the database file", async () => {
    const url = `file:${join(dir, "wal.db")}`;

    const first = createPrismaClient(url);
    try {
      expect(await ensureWal(first)).toBe("wal");
    } finally {
      await first.$disconnect();
    }

    // journal_mode lives in the file header, so a brand-new connection inherits it.
    const second = createPrismaClient(url);
    try {
      const [{ journal_mode }] = await second.$queryRawUnsafe<{ journal_mode: string }[]>(
        "PRAGMA journal_mode",
      );
      expect(journal_mode).toBe("wal");
    } finally {
      await second.$disconnect();
    }
  });

  it("applies busy_timeout per connection, so a lock collision waits instead of failing", async () => {
    // Raw SQLite integers come back as BigInt through the driver adapter.
    const [{ timeout }] = await db.$queryRawUnsafe<{ timeout: bigint }[]>("PRAGMA busy_timeout");
    expect(timeout).toBe(5_000n);
  });
});
