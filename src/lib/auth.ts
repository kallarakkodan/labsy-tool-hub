import { hkdfSync, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { getEnv } from "@/lib/env";

/*
 * Authentication (PRD §8.1, ADR-0001).
 *
 * One shared password, one encrypted cookie, no session store. The route guard
 * in `proxy.ts` runs on the Node runtime in Next 16, so this module is free to
 * use `node:crypto` — that is why there is no Edge/Node split here.
 *
 * Two things are deliberately absent:
 *   - No user identity. The session says "someone knew the password" and
 *     nothing more, which is exactly what PRD §11.4 admits to.
 *   - No revocation. Logout clears the cookie; rotating AUTH_SECRET invalidates
 *     every session at once and is the break-glass.
 */

const SESSION_COOKIE = "labsy_session";

/**
 * `promisify(scrypt)` types away the 4-argument overload that takes options, so
 * the parameters below could not be passed. Wrapping it by hand keeps them.
 */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/*
 * scrypt parameters, stored *inside* the hash string so they can be raised later
 * without invalidating existing hashes or needing a format migration.
 *
 * N=16384, r=8 needs 128*N*r ≈ 16 MiB, which sits under Node's default 32 MiB
 * maxmem. Raising N past 2^15 requires passing maxmem explicitly — worth knowing
 * before someone bumps it and gets a confusing runtime error.
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export interface Session {
  admin: true;
  /** Seconds since epoch, set by `EncryptJWT`. */
  iat?: number;
  exp?: number;
}

// --- password ----------------------------------------------------------------

/** `scrypt$N$r$p$salt$hash`, all base64. Used by `pnpm gen:hash`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Compare a submitted password against `ADMIN_PASSWORD_HASH`.
 *
 * The comparison is timing-safe on the **derived key**, not on the password
 * string: comparing passwords directly would leak their length and prefix
 * through timing, and comparing derived keys is what scrypt is for.
 */
export async function verifyPassword(plain: string): Promise<boolean> {
  const stored = getEnv().ADMIN_PASSWORD_HASH;
  const parsed = parseHash(stored);
  if (parsed === null) {
    console.error("[auth] ADMIN_PASSWORD_HASH is not a recognised scrypt hash");
    return false;
  }

  const derived = await scryptAsync(plain, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
  });

  // Equal lengths are guaranteed by deriving to parsed.hash.length, so
  // timingSafeEqual cannot throw here.
  return timingSafeEqual(derived, parsed.hash);
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [, n, r, p, salt, hash] = parts;
  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt!, "base64"),
    hash: Buffer.from(hash!, "base64"),
  };

  const sane =
    Number.isInteger(parsed.N) &&
    Number.isInteger(parsed.r) &&
    Number.isInteger(parsed.p) &&
    parsed.salt.length > 0 &&
    parsed.hash.length > 0;

  return sane ? parsed : null;
}

// --- session token -----------------------------------------------------------

/**
 * Derive the AES key from `AUTH_SECRET` rather than using the secret directly.
 *
 * HKDF with a fixed info string means the same secret could later key a second
 * purpose (a signed download URL, say) without the two sharing key material.
 */
function sessionKey(): Uint8Array {
  const secret = getEnv().AUTH_SECRET;
  return new Uint8Array(hkdfSync("sha256", secret, "labsy-session-v1", "labsy-session-key", 32));
}

/** Encrypted, not merely signed, so the payload is opaque to the client. */
export async function sealToken(): Promise<string> {
  const ttlHours = getEnv().SESSION_TTL_HOURS;

  return new EncryptJWT({ admin: true })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .encrypt(sessionKey());
}

/**
 * Decrypt and validate. Returns null for anything wrong — tampered, truncated,
 * expired, or encrypted under a different secret. Callers must not distinguish
 * those cases to the client; they are all just "not signed in".
 */
export async function unsealToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(token, sessionKey());
    return payload.admin === true ? (payload as unknown as Session) : null;
  } catch {
    return null;
  }
}

// --- cookie ------------------------------------------------------------------

/** Set the session cookie. Callable only from a Route Handler or Server Action. */
export async function createSession(): Promise<void> {
  const env = getEnv();
  const store = await cookies();

  store.set(SESSION_COOKIE, await sealToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Dev-only escape hatch; lib/env.ts refuses to boot with this false in production.
    secure: env.COOKIE_SECURE,
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The current session, or null.
 *
 * Never derive admin-ness from a query parameter, a header, or anything else the
 * client controls (CONTEXT §7.4). This feeds `toolVisibilityWhere`, so a
 * spoofable source here exposes every draft and internal tool at once.
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) return null;
  return unsealToken(token);
}

export async function isAdmin(): Promise<boolean> {
  return (await getSession()) !== null;
}

export { SESSION_COOKIE };
