import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

const repoRoot = resolve(import.meta.dirname, "..");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "labsy-health-"));
  const dbUrl = `file:${join(dir, "health.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = dir;
  process.env.DATABASE_URL = dbUrl;
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.AUTH_SECRET = "x".repeat(32);
  process.env.NEXT_PUBLIC_APP_VERSION = "1.2.3";
  resetEnvCache();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("reports healthy with the version and tool count", async () => {
    const { GET } = await import("../src/app/api/health/route");
    const body = await (await GET()).json();

    expect(body).toMatchObject({
      ok: true,
      version: "1.2.3",
      storageRootWritable: true,
      dbOk: true,
      toolCount: 0,
    });
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("never returns a host path — it is unauthenticated", async () => {
    const { GET } = await import("../src/app/api/health/route");
    const text = await (await GET()).text();

    expect(text).not.toContain(dir);
    expect(text).not.toContain("/srv/downloads");
  });

  it("is uncacheable, because a cached health check is worse than none", async () => {
    const { GET } = await import("../src/app/api/health/route");
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });

  it("stays 200 with ok:false when degraded, so the dot can tell unhealthy from unreachable", async () => {
    const { GET } = await import("../src/app/api/health/route");
    chmodSync(dir, 0o000);
    try {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(false);
      expect(body.storageRootWritable).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
