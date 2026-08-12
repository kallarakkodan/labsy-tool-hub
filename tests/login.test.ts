import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import { resetRateLimits } from "../src/lib/rate-limit";

/*
 * The login route end to end, minus Next's request scope (CONTEXT §9, "Auth").
 *
 * `next/headers` is mocked with a jar that keeps the options it was called
 * with, because the cookie *flags* are half of what PRD §8.1 specifies and a
 * mock that only stored the value would let `Secure` silently go missing.
 */

const repoRoot = resolve(import.meta.dirname, "..");
const CORRECT = "correct-horse-battery-staple";
const CLIENT = { "x-forwarded-for": "10.20.30.40" };

interface Jarred {
  value: string;
  options: { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };
}

const jar = new Map<string, Jarred>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const entry = jar.get(name);
        return entry === undefined ? undefined : { name, value: entry.value };
      },
      set: (name: string, value: string, options: Jarred["options"]) => {
        jar.set(name, { value, options });
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    }),
}));

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "labsy-login-"));
  const dbUrl = `file:${join(dir, "login.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = dir;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.SESSION_TTL_HOURS = "8";
  // Well-formed but meaningless: `getEnv()` shape-checks the hash, so it has to
  // parse before `hashPassword` can produce the real one on the next line.
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  resetEnvCache();

  const { hashPassword } = await import("../src/lib/auth");
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(CORRECT);
  resetEnvCache();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRateLimits();
  jar.clear();
  const { prisma } = await import("../src/lib/db");
  await prisma.auditLog.deleteMany();
});

async function login(password: unknown, headers: Record<string, string> = CLIENT): Promise<Response> {
  const { POST } = await import("../src/app/api/auth/login/route");
  return POST(
    new Request("http://hub.labsy.internal/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ password }),
    }),
  );
}

async function auditRows() {
  const { prisma } = await import("../src/lib/db");
  return prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
}

describe("POST /api/auth/login — the happy path", () => {
  it("accepts the password and seals a session", async () => {
    const response = await login(CORRECT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const { SESSION_COOKIE, unsealToken } = await import("../src/lib/auth");
    const cookie = jar.get(SESSION_COOKIE);
    expect(cookie).toBeDefined();
    await expect(unsealToken(cookie!.value)).resolves.toMatchObject({ admin: true });
  });

  it("sets Secure, HttpOnly and SameSite=Lax (PRD §8.1, §14)", async () => {
    await login(CORRECT);

    const { SESSION_COOKIE } = await import("../src/lib/auth");
    expect(jar.get(SESSION_COOKIE)!.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("expires after 8 hours, in both the cookie and the token (PRD §14)", async () => {
    await login(CORRECT);

    const { SESSION_COOKIE, unsealToken } = await import("../src/lib/auth");
    const cookie = jar.get(SESSION_COOKIE)!;
    expect(cookie.options.maxAge).toBe(8 * 3600);

    // The cookie lifetime is a browser hint; the token's own expiry is the one
    // that is enforced, so the two must agree or a session outlives its proof.
    const session = await unsealToken(cookie.value);
    expect(session!.exp! - session!.iat!).toBe(8 * 3600);
  });

  it("writes no audit row for a success — §11.2 logs failures", async () => {
    await login(CORRECT);
    await expect(auditRows()).resolves.toHaveLength(0);
  });
});

describe("POST /api/auth/login — rejection", () => {
  it("returns 401 with a generic message and no cookie", async () => {
    const response = await login("wrong-horse-battery-staple");
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    // Nothing in the message distinguishes a bad password from a lockout.
    expect(body.error.message).not.toMatch(/rate|limit|429/i);
    expect(jar.size).toBe(0);
  });

  it("reports the attempts left, which is what the page shows the admin", async () => {
    for (const expected of ["4", "3", "2", "1", "0"]) {
      const response = await login("nope");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe(expected);
    }
  });

  it("sends Retry-After on the failure that uses up the last attempt", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await login("nope")).headers.get("Retry-After")).toBeNull();
    }

    const last = await login("nope");
    expect(last.status).toBe(401);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("rejects a body that is not a password", async () => {
    for (const body of [undefined, 42, "", "x".repeat(2000)]) {
      const response = await login(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    }
  });

  it("does not spend an attempt on a malformed body", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) await login(undefined);
    expect((await login(CORRECT)).status).toBe(200);
  });
});

describe("POST /api/auth/login — rate limit (PRD §14: wrong password 6× returns 429)", () => {
  it("returns 429 with Retry-After on the sixth attempt", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login("nope")).status).toBe(401);
    }

    const sixth = await login("nope");
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(sixth.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("refuses even the correct password once the bucket is full", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await login("nope");

    expect((await login(CORRECT)).status).toBe(429);
    expect(jar.size).toBe(0);
  });

  it("locks the IP, not the office (CONTEXT §2 item 6)", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) await login("nope");

    const colleague = await login(CORRECT, { "x-forwarded-for": "10.20.30.41" });
    expect(colleague.status).toBe(200);
  });

  it("forgets the failures after a successful sign-in", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await login("nope");
    expect((await login(CORRECT)).status).toBe(200);

    // The four earlier typos are gone, so a fifth mistake is not a lockout.
    expect((await login("nope")).headers.get("X-RateLimit-Remaining")).toBe("4");
  });
});

describe("AuditLog (PRD §8.1)", () => {
  it("records every failure with the client IP", async () => {
    await login("nope");
    await login("nope");

    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "auth.login.fail", actorIp: "10.20.30.40" });
  });

  it("does not record a rate-limited attempt — that is the flood, not a failure", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) await login("nope");
    await expect(auditRows()).resolves.toHaveLength(5);
  });

  it("falls back to a sentinel IP rather than dropping the row", async () => {
    await login("nope", { "x-forwarded-for": "not-an-ip" });

    const { UNKNOWN_IP } = await import("../src/lib/request");
    expect((await auditRows())[0]).toMatchObject({ actorIp: UNKNOWN_IP });
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie", async () => {
    await login(CORRECT);
    const { SESSION_COOKIE } = await import("../src/lib/auth");
    expect(jar.has(SESSION_COOKIE)).toBe(true);

    const { POST } = await import("../src/app/api/auth/logout/route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("is a no-op when nobody is signed in", async () => {
    const { POST } = await import("../src/app/api/auth/logout/route");
    expect((await POST()).status).toBe(200);
  });
});
