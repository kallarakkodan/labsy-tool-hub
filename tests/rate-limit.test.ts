import { beforeEach, describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  checkRateLimit,
  clearRateLimit,
  consumeRateLimit,
  recordAttempt,
  resetRateLimits,
} from "../src/lib/rate-limit";

/*
 * Time is passed in explicitly rather than faked globally. The limiter's whole
 * behaviour is a function of `now`, so handing it a timestamp is both the
 * simplest way to test it and a check that no code path reaches for the clock
 * behind the caller's back.
 */

const T0 = 1_770_000_000_000; // a fixed Tuesday, so failures are reproducible
const LOGIN_WINDOW = RATE_LIMITS.login.windowMs;

beforeEach(() => {
  resetRateLimits();
});

describe("login limit — 5 per 15 minutes (PRD §11.2)", () => {
  it("allows five attempts and refuses the sixth with a Retry-After", () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const before = checkRateLimit("login", "10.0.0.5", T0);
      expect(before.allowed).toBe(true);
      expect(before.remaining).toBe(6 - attempt);
      recordAttempt("login", "10.0.0.5", T0);
    }

    const sixth = checkRateLimit("login", "10.0.0.5", T0);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.retryAfter).toBe(LOGIN_WINDOW / 1000);
  });

  it("never reports Retry-After: 0, which would invite an immediate refusal", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordAttempt("login", "10.0.0.5", T0);

    // One millisecond before the oldest hit expires: still blocked, still positive.
    const result = checkRateLimit("login", "10.0.0.5", T0 + LOGIN_WINDOW - 1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(1);
  });
});

describe("bucket isolation", () => {
  it("gives two IPs independent buckets — one typo must not lock the office", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordAttempt("login", "10.0.0.5", T0);

    expect(checkRateLimit("login", "10.0.0.5", T0).allowed).toBe(false);
    expect(checkRateLimit("login", "10.0.0.6", T0)).toEqual({
      allowed: true,
      remaining: 5,
      retryAfter: 0,
    });
  });

  it("keeps limits apart even when the key is identical", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordAttempt("login", "shared-key", T0);

    expect(checkRateLimit("login", "shared-key", T0).allowed).toBe(false);
    expect(checkRateLimit("browse", "shared-key", T0).remaining).toBe(RATE_LIMITS.browse.limit);
  });
});

describe("the window slides", () => {
  it("recovers one attempt at a time as each hit ages out", () => {
    // Five failures, one minute apart.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordAttempt("login", "10.0.0.5", T0 + attempt * 60_000);
    }

    const last = T0 + 4 * 60_000;
    expect(checkRateLimit("login", "10.0.0.5", last).allowed).toBe(false);

    // 15 minutes after the *first* failure, only that one has expired.
    const afterFirst = checkRateLimit("login", "10.0.0.5", T0 + LOGIN_WINDOW + 1);
    expect(afterFirst.allowed).toBe(true);
    expect(afterFirst.remaining).toBe(1);

    // A fixed-bucket counter would have reset all five here; a sliding one has not.
    expect(checkRateLimit("login", "10.0.0.5", T0 + LOGIN_WINDOW + 60_001).remaining).toBe(2);
  });

  it("fully recovers once the window has passed", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) recordAttempt("login", "10.0.0.5", T0);

    expect(checkRateLimit("login", "10.0.0.5", T0 + LOGIN_WINDOW + 1)).toEqual({
      allowed: true,
      remaining: 5,
      retryAfter: 0,
    });
  });
});

describe("consumeRateLimit", () => {
  it("counts every call, unlike the login path's check-then-record", () => {
    const first = consumeRateLimit("browse", "session-a", T0);
    expect(first).toEqual({ allowed: true, remaining: RATE_LIMITS.browse.limit - 1, retryAfter: 0 });

    // `allowed` is a verdict on the call just made, so the last one in the
    // window is permitted even though it leaves no room behind it.
    for (let call = 1; call < RATE_LIMITS.browse.limit; call += 1) {
      expect(consumeRateLimit("browse", "session-a", T0).allowed).toBe(true);
    }
    expect(consumeRateLimit("browse", "session-a", T0)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("does not record a rejected call, so hammering cannot extend the ban", () => {
    for (let call = 0; call < RATE_LIMITS.browse.limit; call += 1) {
      consumeRateLimit("browse", "session-a", T0);
    }

    // Keep hammering for the whole window.
    for (let call = 0; call < 200; call += 1) {
      consumeRateLimit("browse", "session-a", T0 + 30_000);
    }

    // The original 60 hits still expire on schedule; the refused ones added nothing.
    expect(consumeRateLimit("browse", "session-a", T0 + RATE_LIMITS.browse.windowMs + 1).allowed).toBe(true);
  });
});

describe("clearRateLimit", () => {
  it("forgets a key, so a successful login does not carry its typos forward", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) recordAttempt("login", "10.0.0.5", T0);
    expect(checkRateLimit("login", "10.0.0.5", T0).remaining).toBe(1);

    clearRateLimit("login", "10.0.0.5");
    expect(checkRateLimit("login", "10.0.0.5", T0).remaining).toBe(5);
  });
});

describe("bounded memory", () => {
  it("survives a flood of distinct keys without growing without limit", () => {
    // Well-formed but fictional addresses: `clientIp` validates the shape, not
    // the provenance, so this is what a spoofed-XFF flood actually looks like.
    for (let n = 0; n < 30_000; n += 1) {
      recordAttempt("login", `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, T0 + n);
    }

    // The victim of the eviction policy is always the stalest bucket, so a
    // client that keeps hitting the limiter can never evict itself.
    const attacker = checkRateLimit("login", `10.${(29_999 >> 16) & 255}.${(29_999 >> 8) & 255}.${29_999 & 255}`, T0 + 29_999);
    expect(attacker.remaining).toBe(4);
  });
});
