import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/lib/env";
import { hashPassword, sealToken, unsealToken, verifyPassword } from "../src/lib/auth";

/*
 * The cookie-reading helpers (`getSession`, `createSession`) need Next's request
 * scope, so they are exercised through the login route in issue 20. What is
 * tested here is everything that decides *whether* a session is valid, which is
 * the part that must not be wrong.
 */

const CORRECT = "correct-horse-battery-staple";

beforeAll(async () => {
  process.env.STORAGE_ROOT = ".";
  process.env.DATABASE_URL = "file:./test.db";
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.SESSION_TTL_HOURS = "8";
  /*
   * A well-formed dummy first, because `getEnv()` now shape-checks the hash and
   * `hashPassword` cannot run until the environment parses. The real hash of
   * CORRECT replaces it on the next line.
   */
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  resetEnvCache();

  process.env.ADMIN_PASSWORD_HASH = await hashPassword(CORRECT);
  resetEnvCache();
});

describe("hashPassword", () => {
  it("produces a self-describing scrypt string", async () => {
    const hash = await hashPassword(CORRECT);
    const [scheme, n, r, p, salt, digest] = hash.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBe(16_384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt!, "base64")).toHaveLength(16);
    expect(Buffer.from(digest!, "base64")).toHaveLength(32);
  });

  it("salts, so the same password never produces the same hash twice", async () => {
    expect(await hashPassword(CORRECT)).not.toBe(await hashPassword(CORRECT));
  });

  it("carries its parameters, so they can be raised without a format migration", async () => {
    // The verifier reads N/r/p from the stored string rather than from constants.
    const hash = await hashPassword(CORRECT);
    expect(hash.split("$").slice(1, 4)).toEqual(["16384", "8", "1"]);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    await expect(verifyPassword(CORRECT)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    await expect(verifyPassword("wrong-horse-battery-staple")).resolves.toBe(false);
    await expect(verifyPassword("")).resolves.toBe(false);
  });

  it("rejects a near-miss, including case and trailing whitespace", async () => {
    await expect(verifyPassword(CORRECT.toUpperCase())).resolves.toBe(false);
    await expect(verifyPassword(`${CORRECT} `)).resolves.toBe(false);
  });

  it("round-trips a hash generated the way `pnpm gen:hash` generates it", async () => {
    process.env.ADMIN_PASSWORD_HASH = await hashPassword("another-password");
    resetEnvCache();
    try {
      await expect(verifyPassword("another-password")).resolves.toBe(true);
      await expect(verifyPassword(CORRECT)).resolves.toBe(false);
    } finally {
      process.env.ADMIN_PASSWORD_HASH = await hashPassword(CORRECT);
      resetEnvCache();
    }
  });

  /*
   * A malformed stored hash is now caught at the boot gate — `lib/env.ts` grew a
   * shape check after dotenv was found eating the `$` (CONTEXT §3), so a service
   * with an unusable hash never starts.
   *
   * `verifyPassword`'s own parse guard stays as defence in depth and is covered
   * by `parseHash` returning null for each malformed shape in tests/env.test.ts;
   * what this asserts is that the two agree, and that nothing here throws its way
   * out as a 500.
   */
  it("cannot be reached with a malformed hash, because boot refuses one", async () => {
    process.env.ADMIN_PASSWORD_HASH = "not-a-hash";
    resetEnvCache();
    try {
      await expect(verifyPassword(CORRECT)).rejects.toThrow(/ADMIN_PASSWORD_HASH/);
    } finally {
      process.env.ADMIN_PASSWORD_HASH = await hashPassword(CORRECT);
      resetEnvCache();
    }
  });
});

describe("session token", () => {
  it("round-trips a sealed session", async () => {
    const session = await unsealToken(await sealToken());
    expect(session?.admin).toBe(true);
  });

  it("is encrypted, not merely signed — the payload is opaque", async () => {
    const token = await sealToken();
    // A JWS would carry a base64 payload readable without the key. A JWE's
    // middle segments are ciphertext.
    expect(token).not.toContain("admin");
    expect(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).not.toContain("admin");
  });

  it("rejects a tampered token", async () => {
    const token = await sealToken();
    const parts = token.split(".");
    // Flip a character in the ciphertext segment.
    parts[3] = parts[3]!.replace(/^./, (c) => (c === "A" ? "B" : "A"));

    await expect(unsealToken(parts.join("."))).resolves.toBeNull();
  });

  it("rejects a truncated or garbage token", async () => {
    await expect(unsealToken("")).resolves.toBeNull();
    await expect(unsealToken("not.a.token")).resolves.toBeNull();
    await expect(unsealToken((await sealToken()).slice(0, -5))).resolves.toBeNull();
  });

  it("rejects a token sealed under a different AUTH_SECRET", async () => {
    const token = await sealToken();

    process.env.AUTH_SECRET = "b".repeat(48);
    resetEnvCache();
    try {
      // This is the break-glass: rotating AUTH_SECRET invalidates every session.
      await expect(unsealToken(token)).resolves.toBeNull();
    } finally {
      process.env.AUTH_SECRET = "a".repeat(48);
      resetEnvCache();
    }
  });

  it("rejects an expired session", async () => {
    vi.useFakeTimers();
    try {
      const token = await sealToken(); // 8 hour TTL

      vi.setSystemTime(Date.now() + 9 * 3600 * 1000);
      await expect(unsealToken(token)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still accepts a session inside its TTL", async () => {
    vi.useFakeTimers();
    try {
      const token = await sealToken();

      vi.setSystemTime(Date.now() + 7 * 3600 * 1000);
      expect((await unsealToken(token))?.admin).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours a shortened SESSION_TTL_HOURS", async () => {
    process.env.SESSION_TTL_HOURS = "1";
    resetEnvCache();
    vi.useFakeTimers();
    try {
      const token = await sealToken();
      vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
      await expect(unsealToken(token)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
      process.env.SESSION_TTL_HOURS = "8";
      resetEnvCache();
    }
  });
});
