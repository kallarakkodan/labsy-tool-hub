import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvError, parseEnv, type EnvSource } from "../src/lib/env";

let root: string;

/** A complete, valid environment. Each test breaks exactly one thing. */
function validEnv(overrides: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "file:./prisma/dev.db",
    STORAGE_ROOT: root,
    ADMIN_PASSWORD_HASH: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    AUTH_SECRET: "x".repeat(32),
    ...overrides,
  };
}

function problemsFrom(source: EnvSource): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("expected parseEnv to reject, but it succeeded");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "labsy-env-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("accepts a complete environment and applies CONTEXT §3's defaults", () => {
    const env = parseEnv(validEnv());

    expect(env.SESSION_TTL_HOURS).toBe(8);
    expect(env.CHUNK_SIZE).toBe(16_777_216);
    expect(env.UPLOAD_SUBDIR).toBe("uploads");
    expect(env.UPLOAD_TTL_HOURS).toBe(24);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.USE_X_ACCEL).toBe(false);
    expect(env.X_ACCEL_PREFIX).toBe("/_protected");
    expect(env.NEXT_PUBLIC_APP_VERSION).toBe("0.0.0");
  });

  it("coerces numbers and booleans out of their string forms", () => {
    const env = parseEnv(
      validEnv({ CHUNK_SIZE: "8388608", SESSION_TTL_HOURS: "2", COOKIE_SECURE: "false", USE_X_ACCEL: "true" }),
    );

    expect(env.CHUNK_SIZE).toBe(8_388_608);
    expect(env.SESSION_TTL_HOURS).toBe(2);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.USE_X_ACCEL).toBe(true);
  });

  it("freezes the result so nothing can mutate config at runtime", () => {
    const env = parseEnv(validEnv());
    expect(Object.isFrozen(env)).toBe(true);
  });

  describe("refuses to start when", () => {
    it("AUTH_SECRET is missing", () => {
      expect(problemsFrom(validEnv({ AUTH_SECRET: undefined }))).toEqual([
        expect.stringContaining("AUTH_SECRET"),
      ]);
    });

    it("AUTH_SECRET is shorter than 32 bytes", () => {
      const problems = problemsFrom(validEnv({ AUTH_SECRET: "x".repeat(31) }));
      expect(problems[0]).toContain("AUTH_SECRET");
      expect(problems[0]).toContain("32 bytes");
    });

    it("AUTH_SECRET is 32 characters but fewer than 32 bytes is impossible — multibyte counts as bytes", () => {
      // 16 two-byte characters = 32 bytes: long enough, and must be accepted.
      expect(() => parseEnv(validEnv({ AUTH_SECRET: "é".repeat(16) }))).not.toThrow();
      // 16 characters of one byte each = 16 bytes: too short.
      expect(problemsFrom(validEnv({ AUTH_SECRET: "a".repeat(16) }))[0]).toContain("AUTH_SECRET");
    });

    it("ADMIN_PASSWORD_HASH is empty", () => {
      const problems = problemsFrom(validEnv({ ADMIN_PASSWORD_HASH: "" }));
      expect(problems[0]).toContain("ADMIN_PASSWORD_HASH");
      expect(problems[0]).toContain("gen:hash");
    });

    /*
     * The mangled form is what `@next/env` produces from an unescaped hash: it
     * runs dotenv-expand, and `$16384` is read as a variable reference. Before
     * this check the service booted happily and rejected the correct password
     * forever, with one line in the journal to show for it.
     */
    it("ADMIN_PASSWORD_HASH was eaten by dotenv expansion", () => {
      const problems = problemsFrom(
        validEnv({ ADMIN_PASSWORD_HASH: "scrypt6384+dnsdp5kXCQ==+gNdJ121Mz=" }),
      );
      expect(problems[0]).toContain("ADMIN_PASSWORD_HASH");
      expect(problems[0]).toContain("\\$");
    });

    it("ADMIN_PASSWORD_HASH is some other kind of nonsense", () => {
      for (const hash of ["hunter2", "bcrypt$2b$10$abc", "scrypt$16384$8$1$c2FsdA==", "$$$$$"]) {
        expect(problemsFrom(validEnv({ ADMIN_PASSWORD_HASH: hash }))[0]).toContain(
          "ADMIN_PASSWORD_HASH",
        );
      }
    });

    it("accepts the escaped form, because plain dotenv does not un-escape it", () => {
      // `prisma.config.ts` and `prisma/seed.ts` load .env.local with bare
      // `dotenv`, which leaves the backslashes in place. Both loaders must
      // produce a working hash from the same line.
      const escaped = "scrypt\\$16384\\$8\\$1\\$c2FsdA==\\$aGFzaA==";
      expect(parseEnv(validEnv({ ADMIN_PASSWORD_HASH: escaped })).ADMIN_PASSWORD_HASH).toBe(
        "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
      );
    });

    it("STORAGE_ROOT does not exist", () => {
      const problems = problemsFrom(validEnv({ STORAGE_ROOT: join(root, "nope") }));
      expect(problems[0]).toContain("STORAGE_ROOT");
      expect(problems[0]).toContain("does not exist");
    });

    it("STORAGE_ROOT is a file rather than a directory", () => {
      const file = join(root, "a-file");
      writeFileSync(file, "");
      expect(problemsFrom(validEnv({ STORAGE_ROOT: file }))[0]).toContain("not a directory");
    });

    it("STORAGE_ROOT is not readable by this user", () => {
      const unreadable = join(root, "locked");
      mkdirSync(unreadable);
      chmodSync(unreadable, 0o000);
      try {
        const problems = problemsFrom(validEnv({ STORAGE_ROOT: unreadable }));
        expect(problems[0]).toContain("not readable");
        expect(problems[0]).toContain("setfacl");
      } finally {
        chmodSync(unreadable, 0o700);
      }
    });

    it("COOKIE_SECURE is false in production", () => {
      const problems = problemsFrom(validEnv({ NODE_ENV: "production", COOKIE_SECURE: "false" }));
      expect(problems[0]).toContain("COOKIE_SECURE");
      expect(problems[0]).toContain("production");
    });
  });

  it("allows COOKIE_SECURE=false in development, which is the only reason the flag exists", () => {
    expect(parseEnv(validEnv({ NODE_ENV: "development", COOKIE_SECURE: "false" })).COOKIE_SECURE).toBe(false);
  });

  it("reports every problem at once rather than one per restart", () => {
    const problems = problemsFrom({
      NODE_ENV: "production",
      STORAGE_ROOT: join(root, "nope"),
      DATABASE_URL: "file:./x.db",
      ADMIN_PASSWORD_HASH: "",
      AUTH_SECRET: "too-short",
    });

    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join("\n")).toContain("ADMIN_PASSWORD_HASH");
    expect(problems.join("\n")).toContain("AUTH_SECRET");
  });

  it("skips the filesystem check when asked, so `next build` does not need the production storage root", () => {
    expect(() =>
      parseEnv(validEnv({ STORAGE_ROOT: "/srv/downloads-that-does-not-exist-here" }), { checkFilesystem: false }),
    ).not.toThrow();
  });
});
