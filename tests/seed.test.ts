import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

/**
 * The seeder is a CLI, so it is tested as one — through `tsx`, against a throwaway
 * STORAGE_ROOT and database. The sparse-file behaviour in ADR-0002 cannot be
 * observed any other way: it is a property of the filesystem, not of the code.
 */
function runSeeder(args: string[], storageRoot: string, dbUrl: string) {
  return execFileSync("npx", ["tsx", "prisma/seed.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      STORAGE_ROOT: storageRoot,
      DATABASE_URL: dbUrl,
      ADMIN_PASSWORD_HASH: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
      AUTH_SECRET: "x".repeat(32),
    },
  });
}

function withFixture(fn: (storageRoot: string, dbUrl: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "labsy-seed-"));
  const dbUrl = `file:${join(dir, "seed-test.db")}`;
  try {
    execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });
    fn(dir, dbUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("db:seed", () => {
  it("writes placeholders that are large on paper and empty on disk (ADR-0002)", () => {
    withFixture((storageRoot, dbUrl) => {
      runSeeder([], storageRoot, dbUrl);

      const iso = join(storageRoot, "seed", "ubuntu-22.04.4-live-server-amd64.iso");
      const stat = statSync(iso);

      expect(stat.size).toBe(2_100_000_000);
      // 512-byte blocks. A non-sparse 2.1 GB file would allocate ~4.1 million.
      expect(stat.blocks).toBeLessThan(1_000);
    });
  }, 180_000);

  it("is idempotent — re-running does not duplicate rows", () => {
    withFixture((storageRoot, dbUrl) => {
      runSeeder([], storageRoot, dbUrl);
      const second = runSeeder([], storageRoot, dbUrl);

      expect(second).toContain("Seeded 6 tools");
      expect(readdirSync(join(storageRoot, "seed"))).toHaveLength(6);
    });
  }, 180_000);

  it("clears rows and the seed directory, and nothing else in the storage root", () => {
    withFixture((storageRoot, dbUrl) => {
      runSeeder([], storageRoot, dbUrl);

      // A real artifact staged by rsync, which must survive the clear.
      const keeper = join(storageRoot, "staged-by-arun.iso");
      execFileSync("touch", [keeper]);

      const output = runSeeder(["--clear"], storageRoot, dbUrl);

      expect(output).toContain("Removed 6 seeded tools");
      expect(existsSync(join(storageRoot, "seed"))).toBe(false);
      expect(existsSync(keeper)).toBe(true);
    });
  }, 180_000);
});
