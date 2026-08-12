# 20 — Login/logout routes and the login page

Status: resolved
Phase: P2
Blocked by: 18, 19
Spec: PRD §8.1, PRD §9.2, PRD §14 (Admin)

## Why

The one place a shared password is accepted. Everything about it — rate limit,
audit trail, cookie flags — is spelled out in PRD §8.1.

## Scope

- `POST /api/auth/login` — `{ password }`, rate limited per issue 19, sets the
  sealed cookie on success, `401` on failure, `429` when limited.
  Failures write an `auth.login.fail` row to `AuditLog` with `actorIp`.
- `POST /api/auth/logout` — clears the cookie.
- `/admin/login` page: single password field, no username. Token-set styling,
  the input recipe from CONTEXT §5. Shows the remaining-attempts / retry-after
  state clearly rather than a generic error.
- Redirects to the `?next=` path after login when it is a same-origin
  `/admin/**` path, otherwise `/admin`.

## Done when

- [x] Wrong password 6× returns 429 (PRD §14)
- [x] Session survives a reload and expires after 8 hours
- [x] The set cookie carries `Secure`, `HttpOnly`, `SameSite=Lax`
- [x] Login failures appear in `AuditLog`

## Watch out

- The `?next=` value is attacker-controllable — validate it is a relative
  `/admin/**` path before redirecting, never an absolute URL.
- Do not reveal whether the rate limit or the password was the reason for a
  rejection in a way that helps enumeration; a shared single password makes this
  mostly moot, but keep messages generic.
- `COOKIE_SECURE=false` over `http://localhost` is the only dev escape hatch; the
  boot check from issue 03 already prevents it in production.

## Answer

`POST /api/auth/login`, `POST /api/auth/logout`, `/admin/login` and
`src/components/admin/LoginForm.tsx`, with 18 tests in `tests/login.test.ts`.
Verified against a running dev server, not only through the suite:

```
POST /api/auth/login (correct)   200  set-cookie: labsy_session=…; Path=/;
                                      Max-Age=28800; HttpOnly; SameSite=lax
GET  /api/tools    anonymous     total 4
GET  /api/tools    with cookie   total 6
GET  /admin/login  with cookie   307 -> /admin/tools
POST /api/auth/logout            200, /api/tools back to total 4
attempt 1..4                     401  x-ratelimit-remaining: 4,3,2,1
attempt 5                        401  x-ratelimit-remaining: 0  retry-after: 900
attempt 6                        429  retry-after: 900
same password, second IP         200  (the office is not locked out)
AuditLog                         5 rows, auth.login.fail, actorIp 10.9.9.77
```

Decisions:

- **The rate limit is checked before the body is read and recorded only after a
  password is actually wrong.** A malformed body cannot spend an attempt, and
  neither can a correct one.
- **Both rejections carry the same message; the status and headers differ.** The
  message is what an unauthenticated caller reads, so it says nothing. The page
  reads `X-RateLimit-Remaining` and `Retry-After` instead and shows the admin a
  live countdown and the attempts left — which is how the issue's "show the state
  clearly" and its "keep messages generic" both hold at once.
- **The 401 that spends the last attempt carries `Retry-After` too,** so the page
  can start its countdown without the admin having to trigger a 429 to find out
  how long they are locked out.
- **A rate-limited attempt writes no `AuditLog` row.** The flood that triggers it
  is exactly the traffic that would fill the table, and the limiter already knows.
  An audit insert that fails is logged and swallowed: the security control is the
  limiter, the row is the record of it.
- **`?next=` is validated server-side in the page**, so the value reaching the
  client component is already known to be a relative `/admin/**` path.

### Found while verifying: dotenv ate the password hash

The smoke test could not log in with a correct password. `@next/env` runs
**dotenv-expand**, and a scrypt hash is mostly `$`:

```
ADMIN_PASSWORD_HASH="scrypt$16384$8$1$UPMRdb…"   in the file
"scrypt6384+dnsdp5kXCQ==…"                        in process.env
```

Quoting does not help — single and double quotes expand alike — and it happens to
`process.env` values too, so `systemd`'s `EnvironmentFile=` is affected the same
way. Escaping every `$` as `\$` survives both paths. Left in place: this would
have shipped as "the service starts, the login page renders, the correct password
is rejected forever, one line in the journal".

Fixed in four places: `lib/env.ts` shape-checks the hash at the boot gate and
names the escaping in the error; it also accepts the escaped form, because plain
`dotenv` (used by `prisma.config.ts` and `prisma/seed.ts`) does not un-escape and
the two loaders must agree on one env line. `pnpm gen:hash` prints the escaped
form. `.env.example` and CONTEXT §3 say why. The test fixtures that used
`"scrypt$placeholder"` are now well-formed dummies, and issue 35 carries the note
for the production runbook.
