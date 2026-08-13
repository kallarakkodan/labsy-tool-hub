import { isIP } from "node:net";
import { SESSION_COOKIE } from "@/lib/auth";

/*
 * Facts about an incoming request that are only safe to read one particular way
 * (CONTEXT §2 item 6, PRD §11.2).
 *
 * Both helpers here take something the client controls and reduce it to a value
 * that is safe to key on or redirect to. Neither has any other job.
 */

/** The key used when no usable address can be found. */
export const UNKNOWN_IP = "unknown";

/**
 * The caller's IP address, for use as a rate-limit key.
 *
 * Requests arrive `browser → NPM → Node` (PRD §12.4), so the socket address is
 * the proxy's. Keying a limiter on it would put the whole LAN in one bucket and
 * let one mistyped password lock out the office — which is the entire reason
 * this function exists.
 *
 * The value is read from `X-Forwarded-For`, which the client can forge, so it is
 * **validated as an IP** before it is used. That is not about trusting the
 * value — it cannot be trusted — but about bounding the key space: an unchecked
 * header string means every made-up variation gets its own fresh bucket and the
 * limiter stops limiting. `lib/rate-limit.ts` caps the map size for the case
 * where an attacker forges well-formed addresses instead.
 *
 * Next 16 exposes no socket address to a Route Handler (`request.ip` was removed
 * in 15), so the fallback chain ends at `X-Real-IP` — which NPM sets from the
 * connection it accepted — and then at `UNKNOWN_IP`.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = normalizeIp(forwarded.split(",")[0] ?? "");
    if (first !== null) return first;
  }

  const real = request.headers.get("x-real-ip");
  if (real !== null) {
    const ip = normalizeIp(real);
    if (ip !== null) return ip;
  }

  return UNKNOWN_IP;
}

/**
 * Strip the decorations proxies add, then validate. Returns null for anything
 * that is not an IP address, including the empty string.
 *
 * Lowercasing normalises `2001:DB8::1` and `2001:db8::1` onto one bucket. It
 * does not canonicalise further — `::1` and `0:0:0:0:0:0:0:1` remain two keys —
 * which costs an attacker one extra bucket per alias and is not worth an IPv6
 * normaliser to close.
 */
function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (value === "") return null;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed !== null) {
    // "[2001:db8::1]:8080" — the only unambiguous way to write IPv6 with a port.
    value = bracketed[1]!;
  } else if (value.split(":").length === 2) {
    // "10.0.0.4:51234" — exactly one colon can only be IPv4 with a port, since
    // every IPv6 address has at least two.
    value = value.slice(0, value.indexOf(":"));
  }

  // "fe80::1%eth0" — the zone names an interface on the *sender's* host, which
  // is meaningless here and rejected by isIP.
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  return isIP(value) === 0 ? null : value.toLowerCase();
}

/** The key used when no session cookie is present. */
export const UNKNOWN_SESSION = "unknown";

/**
 * The raw session cookie value, for use as a rate-limit key (`lib/rate-limit.ts`'s
 * `browse` and `uploadInit` limits are "keyed by session").
 *
 * Every request from the same signed-in browser carries the same cookie value
 * until the next login, so this buckets one admin's own clicking rather than —
 * as keying on `clientIp()` would — the whole LAN behind whatever address NPM
 * reports (PRD §12.4).
 *
 * Deliberately the *raw* token, not the decrypted session: decrypting here would
 * duplicate `unsealToken` for no benefit, since every caller of this function is
 * behind `src/proxy.ts`'s guard (issue 21) and an invalid or expired cookie never
 * reaches it. This is a rate-limit key, not an authorization decision.
 */
export function sessionKey(request: Request): string {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return UNKNOWN_SESSION;

  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }

  return UNKNOWN_SESSION;
}

/** Where an unvalidated `?next=` lands. */
const ADMIN_HOME = "/admin";

/** `/admin`, `/admin/`, `/admin/tools`, `/admin?x=1` — but not `/administrators`. */
const ADMIN_PATH = /^\/admin(?=$|[/?#])/;

/**
 * Reduce a `?next=` value to a path it is safe to redirect to (issue 20).
 *
 * The value is attacker-controllable and its only legitimate use is bouncing an
 * admin back to the page the guard interrupted, so anything that is not plainly
 * a relative `/admin/**` path becomes `/admin` rather than an error — a failed
 * login redirect should not be a dead end.
 *
 * The two cases worth naming, because both *look* relative:
 *   - `//evil.example/x` is a protocol-relative URL and leaves the origin.
 *   - `/\evil.example/x` becomes the same thing, because browsers normalise
 *     backslashes to forward slashes in the authority position.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return ADMIN_HOME;
  if (value.startsWith("//") || value.includes("\\")) return ADMIN_HOME;

  // A newline in a redirect target is header-injection material if the value
  // ever reaches a `Location` header. Escaped so an editor cannot eat them.
  if (/[\u0000-\u001f\u007f]/.test(value)) return ADMIN_HOME;

  return ADMIN_PATH.test(value) ? value : ADMIN_HOME;
}
