/*
 * In-memory sliding-window rate limiter (PRD §11.2).
 *
 * **This is per-process.** It lives in a Map on the heap, so it does not survive
 * `systemctl restart` and would not be shared by a second instance. That is
 * deliberate and adequate here — PRD §12.3 runs one Node process behind NPM, and
 * a login limiter that forgets on restart is a far smaller problem than a Redis
 * dependency on a LAN box with no internet egress. If this service is ever
 * scaled to two processes, this module is the thing that must be replaced first.
 *
 * The window is a list of hit timestamps per key rather than a fixed counter, so
 * a burst at 14:59 does not get a fresh allowance at 15:00.
 */

export interface LimitConfig {
  /** Hits allowed inside the window. */
  limit: number;
  windowMs: number;
}

/** PRD §11.2's three limits. The key differs per limit — read the comments. */
export const RATE_LIMITS = {
  /** Keyed by `clientIp()`. Only *failed* logins are recorded (PRD §8.1). */
  login: { limit: 5, windowMs: 15 * 60_000 },
  /** Keyed by session. Directory listings are cheap but not free. */
  browse: { limit: 60, windowMs: 60_000 },
  /** Keyed by session. Each init reserves disk, so this one guards space, not CPU. */
  uploadInit: { limit: 20, windowMs: 60 * 60_000 },
} as const satisfies Record<string, LimitConfig>;

export type LimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  /**
   * Whether the caller may act. Each function below says which act it means —
   * for `consumeRateLimit` it is the call just made, for the others it is the
   * next one.
   */
  allowed: boolean;
  /** Hits still available in the current window, after whatever was just recorded. */
  remaining: number;
  /** Seconds until the window has room again. `0` when allowed. */
  retryAfter: number;
}

/*
 * Bounded memory, two ways.
 *
 * `MAX_BUCKETS` is the hard ceiling, for an attacker forging well-formed but
 * fictional IPs in `X-Forwarded-For` — `clientIp()` validates the shape, not the
 * provenance. At the cap, the bucket whose *most recent* hit is oldest is
 * dropped. Evicting by recency rather than insertion order is what stops the
 * attack from being self-serving: a hammering client's own bucket is always the
 * freshest in the map, so it can never evict itself into a clean slate.
 *
 * `SWEEP_INTERVAL_MS` is the ordinary case. Buckets are pruned when touched, and
 * at most once a minute a full pass drops the ones nobody has touched since they
 * expired. It runs on access rather than on a timer so there is no interval
 * holding the event loop open, and it is still bounded: the map only grows on
 * access, and every access is a sweep candidate.
 */
const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

const buckets = new Map<string, number[]>();
let lastSweep = 0;

/**
 * Whether `key` may act, **without recording an attempt**.
 *
 * This is the login case: PRD §8.1 counts failed passwords, not sign-in page
 * visits, so the handler checks first and records only once it knows the
 * password was wrong.
 */
export function checkRateLimit(name: LimitName, key: string, now = Date.now()): RateLimitResult {
  const { config, hits } = readBucket(name, key, now);
  return describe(config, hits, now);
}

/**
 * Record a hit unconditionally and report the bucket *after* it — so `allowed`
 * answers "may they try again", which is what the login handler puts in
 * `X-RateLimit-Remaining` on a 401.
 */
export function recordAttempt(name: LimitName, key: string, now = Date.now()): RateLimitResult {
  const { config, id, hits } = readBucket(name, key, now);
  const updated = [...hits, now];
  store(id, updated);
  return describe(config, updated, now);
}

/**
 * Check and record in one step — the shape browse and upload-init want, where
 * every request counts. Here `allowed` is a verdict on *this* call, not a
 * forecast: the last permitted request in a window returns
 * `{ allowed: true, remaining: 0 }`.
 *
 * A rejected request is *not* recorded. Counting blocked attempts would mean a
 * client that keeps hammering never falls out of its own window, turning a
 * 1-minute limit into an indefinite ban.
 */
export function consumeRateLimit(name: LimitName, key: string, now = Date.now()): RateLimitResult {
  const { config, id, hits } = readBucket(name, key, now);
  if (hits.length >= config.limit) return describe(config, hits, now);

  const updated = [...hits, now];
  store(id, updated);
  return { allowed: true, remaining: config.limit - updated.length, retryAfter: 0 };
}

/**
 * Forget a key's history.
 *
 * Called after a successful login: someone who proves they know the password has
 * not been attacking, and leaving their four earlier typos in place would lock
 * them out on the next genuine slip an hour later.
 */
export function clearRateLimit(name: LimitName, key: string): void {
  buckets.delete(bucketId(name, key));
}

/** Test seam, and the thing to call if the limits are ever made configurable. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

// --- internals ---------------------------------------------------------------

function bucketId(name: LimitName, key: string): string {
  return `${name}:${key}`;
}

interface Bucket {
  config: LimitConfig;
  id: string;
  /** Hits still inside the window, oldest first. */
  hits: number[];
}

function readBucket(name: LimitName, key: string, now: number): Bucket {
  sweepIfDue(now);

  const config = RATE_LIMITS[name];
  const id = bucketId(name, key);
  const existing = buckets.get(id);
  if (existing === undefined) return { config, id, hits: [] };

  const hits = prune(existing, now - config.windowMs);
  if (hits.length === 0) buckets.delete(id);
  else if (hits.length !== existing.length) buckets.set(id, hits);

  return { config, id, hits };
}

/** Drop hits at or before `cutoff`. Timestamps are appended in order, so the survivors are a suffix. */
function prune(hits: number[], cutoff: number): number[] {
  let first = 0;
  while (first < hits.length && hits[first]! <= cutoff) first += 1;
  return first === 0 ? hits : hits.slice(first);
}

/** State of a bucket: is there room for a hit right now, and if not, when. */
function describe(config: LimitConfig, hits: number[], now: number): RateLimitResult {
  const remaining = Math.max(0, config.limit - hits.length);
  if (remaining > 0) return { allowed: true, remaining, retryAfter: 0 };

  // Room appears when the oldest hit leaves the window. Never report 0 seconds:
  // a `Retry-After: 0` invites an immediate retry that is still refused.
  const oldest = hits[0] ?? now;
  return {
    allowed: false,
    remaining: 0,
    retryAfter: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)),
  };
}

function store(id: string, hits: number[]): void {
  if (!buckets.has(id) && buckets.size >= MAX_BUCKETS) evictStalest();
  buckets.set(id, hits);
}

function evictStalest(): void {
  let stalestId: string | null = null;
  let stalestHit = Infinity;

  for (const [id, hits] of buckets) {
    const lastHit = hits[hits.length - 1] ?? 0;
    if (lastHit < stalestHit) {
      stalestHit = lastHit;
      stalestId = id;
    }
  }

  if (stalestId !== null) buckets.delete(stalestId);
}

function sweepIfDue(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;

  for (const [id, hits] of buckets) {
    const name = id.slice(0, id.indexOf(":")) as LimitName;
    const config = RATE_LIMITS[name];
    // A key whose limit no longer exists can only be stale.
    if (config === undefined || prune(hits, now - config.windowMs).length === 0) {
      buckets.delete(id);
    }
  }
}
