# 19 — clientIp() and the rate limiter

Status: resolved
Phase: P2
Blocked by: 03
Spec: CONTEXT §2 item 6, PRD §11.2, PRD §8.1

## Why

CONTEXT §2 calls this out as one of the seven things that will bite you: the app
sits behind NPM, so `request.ip` is the proxy. Key the login limiter on that and
"one person fat-fingering their password five times locks out the entire office."

## Scope

- `src/lib/request.ts`: `clientIp(request)` — take
  `xff.split(",")[0].trim()`, **validate it as an IP**, fall back to the socket
  address when absent or malformed.
- `src/lib/rate-limit.ts`: in-memory sliding window, keyed by an arbitrary string.
  Three configured limits (PRD §11.2):
  - login: 5 per 15 min per IP
  - browse: 60 per min per session
  - upload init: 20 per hour per session
- Exceeded → `429` with a `Retry-After` header, through `apiError`.
- Bounded memory: evict expired buckets on access and on a periodic sweep, so a
  spoofed-XFF flood cannot grow the map without limit.

## Done when

- [x] Test: `clientIp` returns the first XFF entry, rejects `"not-an-ip"` and
      falls back, and handles a missing header
- [x] Test: 5 failures then a 6th returns 429 with `Retry-After`
- [x] Test: two different IPs have independent buckets
- [x] Test: the window slides — a bucket recovers after its interval

## Watch out

- Never key a limiter on the raw `X-Forwarded-For` **string** (CONTEXT §2 item 6);
  a client can send whatever it likes and each variation would get a fresh bucket.
- The limiter is per-process. That is acceptable here (single systemd process),
  but say so in a comment so nobody assumes it survives a restart or a second
  instance.

## Answer

`src/lib/request.ts` and `src/lib/rate-limit.ts`, 25 tests across
`tests/request.test.ts` and `tests/rate-limit.test.ts`.

`clientIp()` takes the first `X-Forwarded-For` entry and validates it with
`node:net`'s `isIP`, after stripping the decorations proxies add: a port in
either the `10.0.0.4:51234` or the `[2001:db8::1]:8080` form, and an IPv6 zone.
IPv6 is lowercased so one client is one bucket. The fallback chain ends at
`X-Real-IP` and then a literal `"unknown"` — **Next 16 exposes no socket address
to a Route Handler** (`request.ip` was removed in 15), so the issue's "fall back
to the socket address" is not reachable and the header NPM sets from the
connection it accepted is the closest equivalent.

`safeNextPath()` also lives here rather than in the login page, because issue 21
builds the `?next=` that this validates. It rejects protocol-relative `//host`,
the backslash variant `/\host` that browsers normalise into it, absolute URLs,
control characters, and the `/administrators` near-miss.

Decisions:

- **The limiter has three entry points, not one.** `checkRateLimit` peeks,
  `recordAttempt` records, `consumeRateLimit` does both. Login needs the split
  because PRD §8.1 counts *failed passwords*, so a malformed body or a correct
  password must not spend someone's five; browse and upload-init want the
  combined form. `allowed` means "this call was permitted" for `consume` and "may
  they act again" for the other two, and each function's doc says which.
- **A rejected call is not recorded.** Counting blocked attempts would mean a
  client that keeps hammering never falls out of its own window, turning a
  one-minute limit into an indefinite ban.
- **A successful login clears the bucket.** Someone who proves they know the
  password was not attacking, and leaving four earlier typos in place would lock
  them out on the next genuine slip.
- **Memory is bounded twice.** Buckets are pruned when touched and swept in full
  at most once a minute, on access rather than on a timer — no interval holding
  the event loop open, and the map only grows on access anyway. `MAX_BUCKETS`
  (10 000) is the hard ceiling for a spoofed-XFF flood of well-formed but
  fictional addresses. Eviction takes the bucket whose *most recent* hit is
  oldest, which is what stops the attack being self-serving: a hammering client's
  own bucket is always the freshest, so it can never evict itself into a clean
  slate.
- **Per-process, stated in the module header.** One systemd process (PRD §12.3),
  so this is adequate; it is also the first thing that must be replaced if the
  service is ever scaled to two.
