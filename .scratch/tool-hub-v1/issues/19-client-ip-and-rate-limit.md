# 19 — clientIp() and the rate limiter

Status: ready-for-agent
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

- [ ] Test: `clientIp` returns the first XFF entry, rejects `"not-an-ip"` and
      falls back, and handles a missing header
- [ ] Test: 5 failures then a 6th returns 429 with `Retry-After`
- [ ] Test: two different IPs have independent buckets
- [ ] Test: the window slides — a bucket recovers after its interval

## Watch out

- Never key a limiter on the raw `X-Forwarded-For` **string** (CONTEXT §2 item 6);
  a client can send whatever it likes and each variation would get a fresh bucket.
- The limiter is per-process. That is acceptable here (single systemd process),
  but say so in a comment so nobody assumes it survives a restart or a second
  instance.
