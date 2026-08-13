import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import { sweepFileMissing } from "../src/lib/file-missing-sweep";

/*
 * The fileMissing integrity sweep (issue 33, PRD §11.3, §16 D4).
 *
 * A real temp storage root and a real SQLite file: whether moving a file away
 * actually gets caught, and whether the sweep genuinely never touches disk,
 * are facts about the real filesystem, not something a mock of `fs` could
 * prove either way.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-sweep-"));
  root = join(dir, "storage");
  mkdirSync(root);

  const dbUrl = `file:${join(dir, "sweep.db")}`;
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
});

async function makeTool(fileName: string, fileMissing = false) {
  const { prisma } = await import("../src/lib/db");
  return prisma.tool.create({
    data: {
      slug: fileName.replace(/[^a-z0-9]/gi, "-").toLowerCase(),
      name: fileName,
      description: "test fixture",
      category: "Test",
      version: "1.0",
      filePath: join(root, fileName),
      fileName,
      fileSize: 1024n,
      mimeType: "application/octet-stream",
      fileMissing,
    },
  });
}

describe("sweepFileMissing", () => {
  it("flags a tool whose file has been moved away", async () => {
    writeFileSync(join(root, "present.iso"), "x".repeat(1024));
    const tool = await makeTool("present.iso");

    renameSync(join(root, "present.iso"), join(root, "moved-away.iso"));
    const summary = await sweepFileMissing();

    expect(summary).toEqual({ checked: 1, newlyMissing: 1, recovered: 0 });
    const { prisma } = await import("../src/lib/db");
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).fileMissing).toBe(true);
  });

  it("clears the flag once the file reappears", async () => {
    writeFileSync(join(root, "elsewhere.iso"), "x".repeat(1024));
    // Registered as missing, pointing at a path that does not (yet) exist.
    const tool = await makeTool("returning.iso", true);

    renameSync(join(root, "elsewhere.iso"), join(root, "returning.iso"));
    const summary = await sweepFileMissing();

    expect(summary).toEqual({ checked: 1, newlyMissing: 0, recovered: 1 });
    const { prisma } = await import("../src/lib/db");
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).fileMissing).toBe(false);
  });

  it("leaves an already-correct row untouched, in both directions", async () => {
    writeFileSync(join(root, "healthy.iso"), "x".repeat(1024));
    await makeTool("healthy.iso", false);
    await makeTool("already-flagged.iso", true); // never existed, stays flagged

    const summary = await sweepFileMissing();

    expect(summary).toEqual({ checked: 2, newlyMissing: 0, recovered: 0 });
  });

  it("checks every registered tool and reports an accurate summary across a mix", async () => {
    writeFileSync(join(root, "a.iso"), "a".repeat(512));
    writeFileSync(join(root, "b.iso"), "b".repeat(512));
    await makeTool("a.iso", false); // stays present
    const goneTool = await makeTool("gone.iso", false); // about to vanish
    const backTool = await makeTool("back.iso", true); // about to reappear
    writeFileSync(join(root, "gone.iso"), "c".repeat(512));
    renameSync(join(root, "gone.iso"), join(root, "gone-renamed.iso"));
    writeFileSync(join(root, "back.iso"), "d".repeat(512));

    const summary = await sweepFileMissing();

    expect(summary).toEqual({ checked: 3, newlyMissing: 1, recovered: 1 });
    const { prisma } = await import("../src/lib/db");
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: goneTool.id } })).fileMissing).toBe(true);
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: backTool.id } })).fileMissing).toBe(false);
  });

  it("never writes to disk — only fileMissing changes, never the files themselves", async () => {
    const content = "unchanged-bytes";
    writeFileSync(join(root, "readonly-check.iso"), content);
    await makeTool("readonly-check.iso");

    await sweepFileMissing();

    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(root, "readonly-check.iso"), "utf8")).toBe(content);
  });

  it("refuses a path that has escaped the root (e.g. STORAGE_ROOT reconfigured) rather than crashing", async () => {
    const outside = join(root, "..", "outside.iso");
    writeFileSync(outside, "x".repeat(1024));
    const { prisma } = await import("../src/lib/db");
    const tool = await prisma.tool.create({
      data: {
        slug: "escaped",
        name: "escaped",
        description: "test fixture",
        category: "Test",
        version: "1.0",
        filePath: outside,
        fileName: "outside.iso",
        fileSize: 1024n,
        mimeType: "application/octet-stream",
      },
    });

    const summary = await sweepFileMissing();

    expect(summary.newlyMissing).toBe(1);
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).fileMissing).toBe(true);
    rmSync(outside, { force: true });
  });
});
